/*
  Turns recorded errors into an email, so a fault is something we are told
  about rather than something we have to remember to go and look for.

  Sent over Resend's REST API with plain fetch rather than their SDK. It is a
  single POST with a bearer token, Node has fetch built in, and this box holds
  the Apify key and the database credentials -- one fewer third-party package
  in that process is worth more than the few lines the SDK would save.

  DORMANT BY DEFAULT. With no RESEND_API_KEY in the environment nothing is
  attempted and nothing warns; the Health page and its badge work regardless.
  That way a missing key degrades alerting rather than breaking error capture.
*/

const ENDPOINT = 'https://api.resend.com/emails';

/*
  Two independent throttles, because a broken deploy is exactly when this
  would otherwise turn into a self-inflicted mail flood.

  PER FAULT: one email per distinct fault per hour. The second through
  four-thousandth occurrence of a bug you have already been told about adds
  nothing.

  GLOBALLY: a hard ceiling per hour across all faults. A deploy that breaks
  twenty things should wake you once or twice, not twenty times, and the free
  Resend tier is 3,000 messages a month -- a loop could eat that in an
  afternoon and leave you with no alerting at all when it actually matters.
*/
const PER_FAULT_COOLDOWN_MS = 60 * 60 * 1000;
const GLOBAL_MAX_PER_HOUR = 6;

const lastSentPerFault = new Map();
let globalWindowStart = 0;
let globalSentThisWindow = 0;

const SLACK_TIMEOUT_MS = 5000;

function config() {
  return {
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.ALERT_EMAIL_TO,
    from: process.env.ALERT_EMAIL_FROM || 'onboarding@resend.dev',
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    appUrl: process.env.APP_URL || 'http://localhost:5173',
  };
}

/*
  Warns once at boot if alerts are configured but APP_URL is not.

  Every alert carries a button through to the Health page, built from
  APP_URL. Unset, it silently falls back to localhost, so alerts from a
  production box arrive with a link that only works on the machine nobody is
  holding. Nothing errors and nothing looks wrong until the one moment you
  actually need to click it, which is why this is worth a startup warning.
*/
let warnedAboutAppUrl = false;
function warnIfNoAppUrl() {
  if (warnedAboutAppUrl) return;
  warnedAboutAppUrl = true;
  const c = config();
  const isProd = process.env.NODE_ENV === 'production';
  if ((c.slackWebhook || (c.apiKey && c.to)) && !process.env.APP_URL && isProd) {
    console.warn(
      '[Alerting] APP_URL is not set, so alert links will point at localhost. '
      + 'Set APP_URL to your public URL (e.g. https://app.reelytic.com) in .env.'
    );
  }
}

function emailConfigured() {
  const c = config();
  return Boolean(c.apiKey && c.to);
}

function slackConfigured() {
  return Boolean(config().slackWebhook);
}

// Either channel being present is enough. Both is better, and is the default
// if both are configured: Slack for the push notification, email as the
// fallback for when Slack itself is the thing that is down.
function isConfigured() {
  return emailConfigured() || slackConfigured();
}

/*
  Posts to a Slack incoming webhook.

  Slack allows one message per second per channel and answers 429 with a
  Retry-After when exceeded. The throttling above caps this at 6 an hour, so
  the limit cannot be reached, but the 429 is still reported rather than
  swallowed so a future change that loosens throttling shows up immediately
  instead of silently dropping alerts.
*/
async function sendSlack({ text, blocks }) {
  const c = config();
  if (!c.slackWebhook) return { sent: false, reason: 'slack-not-configured' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(c.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, blocks }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const hint = res.status === 404
        ? 'Slack returned 404: the webhook URL is wrong, or the app was uninstalled from the workspace. Regenerate it under Incoming Webhooks.'
        : res.status === 429
          ? 'Slack rate limited this webhook (1 message per second per channel).'
          : null;
      return { sent: false, reason: `slack-http-${res.status}`, detail: detail.slice(0, 200), hint };
    }
    return { sent: true };
  } catch (err) {
    const aborted = err.name === 'AbortError';
    return { sent: false, reason: aborted ? 'slack-timeout' : 'slack-network', detail: err.message };
  }
}

/*
  Slack Block Kit payload.

  `text` is set as well as `blocks` on purpose: it is what Slack shows in the
  phone push notification and the channel list preview. Blocks alone produce a
  notification reading "This content can't be displayed", which defeats the
  entire point of alerting to a phone.
*/
const KIND_TITLE = {
  server: 'Server error',
  'client-crash': 'Screen crashed for a user',
  'client-error': 'Script error',
  'client-rejection': 'Unhandled promise rejection',
  'api-failure': 'API call failed',
  'console-error': 'Logged error',
};

/*
  The alert has to be enough to triage from a phone without opening a laptop.

  That means the actual error text, the page the user was on, the component
  that threw, and the top of the stack -- in that order, because that is the
  order you need them in to decide "is this urgent" and "where do I look". An
  alert that only says something broke just moves the work to later.
*/
function buildSlackMessage(fault, { spiking }) {
  const c = config();
  const ctx = fault.lastContext || {};
  const extra = ctx.extra || {};
  const kindTitle = KIND_TITLE[fault.kind] || fault.kind;
  const headline = spiking ? `${kindTitle} spiking (${fault.count}x)` : kindTitle;

  const users = fault.affectedUsers || [];
  const facts = [
    ['Page', extra.pagePath],
    ['Route', fault.route],
    ['Component', extra.component],
    ['HTTP', fault.status],
    ['Occurrences', fault.count],
    ['Users hit', users.length ? `${users.length} (${users.slice(0, 3).join(', ')}${users.length > 3 ? '…' : ''})` : null],
    ['Viewport', extra.viewport],
    ['First seen', fault.firstSeenAt ? new Date(fault.firstSeenAt).toISOString().replace('T', ' ').slice(0, 16) : null],
  ].filter(([, v]) => v != null && v !== '');

  /*
    Top stack frames only. Slack truncates long blocks and a full trace is
    unreadable on a phone; the first few frames are what actually identify
    the fault. Node stacks are unminified so these are genuinely useful;
    browser ones are minified and mainly serve to confirm which bundle.
  */
  const stackPreview = ctx.stack
    ? String(ctx.stack).split('\n').slice(0, 5).map((l) => l.trim()).join('\n').slice(0, 700)
    : null;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Reelytic: ${headline}`.slice(0, 150), emoji: false },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${String(fault.message || 'Unknown error').slice(0, 600)}*` },
    },
  ];

  if (facts.length) {
    // Slack caps a fields array at 10 and each at 2000 chars.
    blocks.push({
      type: 'section',
      fields: facts.slice(0, 10).map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${String(v).slice(0, 150)}` })),
    });
  }

  if (stackPreview) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${stackPreview}\`\`\`` } });
  }

  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: 'Open Health page' },
      url: `${c.appUrl}/admin/health`,
      style: spiking ? 'danger' : 'primary',
    }],
  });

  // Says plainly that this will not repeat, so silence afterwards is not
  // mistaken for the problem having gone away.
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Group \`${fault._id}\` · repeats suppressed for 1 hour · max ${GLOBAL_MAX_PER_HOUR} alerts/hour`,
    }],
  });

  return {
    // Drives the phone notification and the channel preview, so it carries
    // the message itself rather than a generic title.
    text: `Reelytic ${headline}: ${String(fault.message || '').slice(0, 140)}`,
    blocks,
  };
}

function allowedToSend(faultId) {
  const now = Date.now();

  if (now - globalWindowStart > 60 * 60 * 1000) {
    globalWindowStart = now;
    globalSentThisWindow = 0;
  }
  if (globalSentThisWindow >= GLOBAL_MAX_PER_HOUR) return false;

  const last = lastSentPerFault.get(faultId);
  if (last && now - last < PER_FAULT_COOLDOWN_MS) return false;

  lastSentPerFault.set(faultId, now);
  globalSentThisWindow += 1;
  return true;
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/*
  Sends one email. Returns a result object rather than throwing, because every
  caller is on an error path already and a failed alert must never escalate
  into a second fault.
*/
async function sendEmail({ subject, html }) {
  const c = config();
  if (!c.apiKey || !c.to) return { sent: false, reason: 'not-configured' };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: c.from, to: [c.to], subject, html }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      /*
        Resend's most common rejection by far: the shared onboarding sender
        may only deliver to the address the account was registered with. It
        returns a generic 403, so it gets named explicitly here -- otherwise
        this looks like a broken key and sends you debugging the wrong thing.
      */
      const hint = res.status === 403 && /onboarding@resend\.dev/.test(c.from)
        ? 'The onboarding@resend.dev sender can only deliver to your own Resend signup address. Verify a domain or set ALERT_EMAIL_TO to that address.'
        : null;
      return { sent: false, reason: `http-${res.status}`, detail: detail.slice(0, 400), hint };
    }

    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'network', detail: err.message };
  }
}

// Deliberately plain. This is read on a phone, at speed, to answer one
// question: how bad is it and where do I look.
function buildHtml(fault) {
  const c = config();
  const ctx = fault.lastContext || {};
  const extra = ctx.extra || {};
  const users = fault.affectedUsers || [];
  const rows = [
    ['Page', extra.pagePath || null],
    ['Route', fault.route || null],
    ['Component', extra.component || null],
    ['Kind', KIND_TITLE[fault.kind] || fault.kind],
    ['HTTP status', fault.status || null],
    ['Times so far', fault.count],
    ['Users affected', users.length ? `${users.length} (${users.slice(0, 3).join(', ')}${users.length > 3 ? '…' : ''})` : null],
    ['Viewport', extra.viewport || null],
  ].filter(([, v]) => v != null && v !== '');

  const stackPreview = ctx.stack
    ? String(ctx.stack).split('\n').slice(0, 6).map((l) => l.trim()).join('\n')
    : null;

  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px;font-size:18px">Reelytic: ${escapeHtml(KIND_TITLE[fault.kind] || 'something is broken')}</h2>
      <p style="margin:0 0 14px;padding:10px 12px;background:#FDF2F4;border-left:3px solid #E23E57;
                color:#1A1C20;font-size:14px;font-weight:600;word-break:break-word">
        ${escapeHtml(String(fault.message || 'Unknown error').slice(0, 400))}
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        ${rows.map(([k, v]) => `
          <tr>
            <td style="padding:6px 10px 6px 0;color:#8B8F98;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>
            <td style="padding:6px 0;color:#1A1C20;word-break:break-word"><strong>${escapeHtml(v)}</strong></td>
          </tr>`).join('')}
      </table>
      ${stackPreview ? `
        <pre style="margin:16px 0 0;padding:12px;background:#F1EFEA;border-radius:6px;font-size:12px;
                    color:#5D6169;white-space:pre-wrap;word-break:break-word;overflow:auto">${escapeHtml(stackPreview)}</pre>` : ''}
      <p style="margin:14px 0 0;color:#8B8F98;font-size:12px">
        Repeats of this fault are suppressed for an hour, so silence does not mean it has stopped.
      </p>
      <p style="margin:20px 0 0">
        <a href="${escapeHtml(c.appUrl)}/admin/health"
           style="background:#E23E57;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:13px;display:inline-block">
          Open Health page
        </a>
      </p>
    </div>`;
}

/*
  Called after a fault is recorded. Alerts only on the FIRST sighting of a
  fault, or when a known one spikes.

  Deliberately does not alert on every occurrence: the value of an alert is
  that it means something, and an inbox that fills up on a bad afternoon
  stops being read at precisely the moment it matters most.
*/
async function maybeAlert(fault, { isNew }) {
  try {
    warnIfNoAppUrl();
    if (!isConfigured() || !fault) return { sent: false, reason: 'not-configured' };

    const SPIKE_AT = 25;
    const spiking = fault.count === SPIKE_AT;
    if (!isNew && !spiking) return { sent: false, reason: 'not-noteworthy' };

    // 401/403 and other correct refusals never reach here (see the callers),
    // but guard anyway: an alert about the app working is worse than silence.
    if (fault.status === 401 || fault.status === 403) return { sent: false, reason: 'expected-status' };

    if (!allowedToSend(fault._id)) return { sent: false, reason: 'throttled' };

    const prefix = spiking ? `Spiking (${fault.count}x)` : 'New fault';

    /*
      Both channels, in parallel, and one failing never stops the other.
      Slack is the one that reaches a phone; email is the fallback for when
      Slack is itself unreachable, which is exactly the moment an alert
      matters most.
    */
    const [slack, email] = await Promise.all([
      slackConfigured() ? sendSlack(buildSlackMessage(fault, { spiking })) : Promise.resolve({ sent: false, reason: 'slack-not-configured' }),
      emailConfigured() ? sendEmail({
        subject: `[Reelytic] ${prefix}: ${String(fault.message || '').slice(0, 90)}`,
        html: buildHtml(fault),
      }) : Promise.resolve({ sent: false, reason: 'email-not-configured' }),
    ]);

    return { sent: slack.sent || email.sent, slack, email };
  } catch (err) {
    return { sent: false, reason: 'alert-failed', detail: err.message };
  }
}

// Used by `npm run alert:test` to prove the credentials and sender work
// before relying on them.
async function sendTestAlert() {
  const c = config();
  if (!isConfigured()) {
    return {
      sent: false,
      reason: 'not-configured',
      hint: 'Add SLACK_WEBHOOK_URL and/or RESEND_API_KEY + ALERT_EMAIL_TO to the .env in the PROJECT ROOT (not server/.env).',
    };
  }

  /*
    A realistic sample fault, pushed through the SAME builders the real path
    uses.

    The first version of this sent a bespoke "alerting works" message, which
    proved the credentials but showed a format nothing like an actual alert --
    so the test looked uninformative while real alerts carried far more. If
    the test does not render exactly what production renders, it is not a
    test of anything worth knowing.
  */
  const sample = {
    _id: 'sample000000test',
    kind: 'client-crash',
    message: "Cannot read properties of undefined (reading 'counts')",
    route: 'GET /api/jobs/<id>/results',
    status: 500,
    count: 1,
    firstSeenAt: new Date(),
    affectedUsers: ['anshuman'],
    lastContext: {
      stack: [
        "TypeError: Cannot read properties of undefined (reading 'counts')",
        '    at ReportEngine (ReportEngine.jsx:1212:34)',
        '    at renderWithHooks (react-dom.js:15486:18)',
        '    at mountIndeterminateComponent (react-dom.js:20103:13)',
      ].join('\n'),
      extra: { pagePath: '/reels?job=6a7d5aa7', component: 'ReportEngine', viewport: '1280x631' },
    },
  };

  const slackPayload = buildSlackMessage(sample, { spiking: false });

  // Each channel is tested independently so a working Slack is not hidden by
  // a broken email setup, or the reverse.
  const [slack, email] = await Promise.all([
    slackConfigured() ? sendSlack({
      text: `[TEST] ${slackPayload.text}`,
      blocks: [
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '*This is a test.* Below is exactly how a real alert looks.' }],
        },
        ...slackPayload.blocks,
      ],
    }) : Promise.resolve({ sent: false, reason: 'slack-not-configured' }),
    emailConfigured() ? sendEmail({
      subject: '[Reelytic] TEST alert (this is what a real one looks like)',
      html: `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#5D6169">
               <strong>This is a test.</strong> Below is exactly how a real alert looks.
             </p>${buildHtml(sample)}`,
    }) : Promise.resolve({ sent: false, reason: 'email-not-configured' }),
  ]);

  return {
    sent: slack.sent || email.sent,
    slack: { ...slack, channel: slackConfigured() ? 'configured' : 'not set' },
    email: { ...email, to: c.to || null, from: c.from },
  };
}

module.exports = { maybeAlert, sendTestAlert, isConfigured, slackConfigured, emailConfigured };
