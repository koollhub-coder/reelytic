/*
  Transactional email (OTP codes, account verification) -- deliberately
  separate from alerting.service.js even though both call the same Resend
  REST endpoint with the same bearer-token pattern.

  The difference is what happens on failure. alerting.service.js swallows
  every error on purpose (a failed error-alert must never itself become a
  second fault, on a path nobody is waiting on). An OTP email is the opposite:
  it is the ONLY way the person mid-signup receives their code, so a failure
  here has to surface as a real error back to that request rather than
  disappear silently and leave them staring at a "check your email" screen
  that lied.

  Same "dormant without a key" contract as alerting: no RESEND_API_KEY means
  every call throws a clear, specific error immediately rather than pretending
  to have sent something.
*/

const ENDPOINT = 'https://api.resend.com/emails';

// Renamed on import (not `config`) -- this file already has its own local
// config() below for the Resend API key/from-address; appConfig is only
// ever used for appConfig.appUrl, to build an absolute, publicly-fetchable
// logo URL. Email clients render the logo by having THEIR OWN servers fetch
// it, same reasoning as the Razorpay checkout logo -- a relative path or a
// localhost URL resolves against nothing they can reach.
const appConfig = require('../config');
const LOGO_URL = `${appConfig.appUrl}/logo-mark-128.png`;

// Shared header row for every email template below -- was plain "Reelytic"
// text with no image at all (the account's actual logo never rendered,
// email clients showed nothing where a brand mark belongs). Table-based
// layout, inline styles, explicit width/height on the <img> -- the same
// constraints as everywhere else in this file, since this has to survive
// Outlook/Gmail's HTML stripping, not just modern browsers.
function logoHeader() {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:8px;vertical-align:middle;">
      <img src="${LOGO_URL}" width="22" height="22" alt="" style="display:block;border-radius:5px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#1A1C20;">Reel<span style="color:#E23E57;">ytic</span></span>
    </td>
  </tr></table>`;
}

function config() {
  return {
    apiKey: process.env.RESEND_API_KEY,
    // Separate from ALERT_EMAIL_FROM on purpose -- alerting mail goes to one
    // fixed ops inbox and can stay on the shared onboarding sender forever;
    // OTP mail goes to arbitrary signups and needs a verified domain the
    // moment this is used for real (see README note this throws about
    // below). Falling back to the same default keeps local dev working
    // with zero setup, same as alerting.
    from: process.env.OTP_EMAIL_FROM || process.env.ALERT_EMAIL_FROM || 'onboarding@resend.dev',
  };
}

async function sendTransactionalEmail({ to, subject, html, text }) {
  const c = config();
  if (!c.apiKey) {
    throw new Error('Email is not configured on this server yet. Set RESEND_API_KEY (see .env.example).');
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: c.from, to: [to], subject, html, text }),
    });
  } catch (err) {
    throw new Error(`Could not reach the email service: ${err.message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Same free-tier trap alerting.service.js already documents: the shared
    // onboarding@resend.dev sender can only deliver to the address the
    // Resend account itself was signed up with. Named explicitly here too,
    // for the same reason -- a generic 403 otherwise reads as a bad key.
    if (res.status === 403 && /onboarding@resend\.dev/.test(c.from)) {
      throw new Error(
        "This server's email sender (onboarding@resend.dev) can only deliver to the address your Resend account was created with. "
        + 'Verify a real sending domain in the Resend dashboard and set OTP_EMAIL_FROM to an address on it before real users can receive OTP codes.'
      );
    }
    throw new Error(`Email service rejected the request (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/*
  Plain, clear, light-background HTML -- an email client is the one surface
  in this whole app that does NOT get the dark theme. Dark-mode HTML email
  is unreliable across clients (Outlook desktop ignores it, Gmail sometimes
  inverts it unpredictably), and this message is read once, fast, usually on
  a phone, by someone trying to finish signing up. The code is the only
  thing that matters, so it's the only thing rendered large.
*/
/*
  Two ways in, one record: the button/link uses verifyUrl (the long random
  token from otp.service.js's issueOtp), the code block still works too --
  whichever the person reaches for first. verifyUrl is optional so this
  still renders correctly for any caller that hasn't been updated to pass
  one (there is none right now, but the function degrades instead of
  breaking rather than assuming every call site is current).
*/
function buildOtpEmailHtml({ code, minutes, verifyUrl }) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F6F3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F6F3;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:420px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E4E1DA;">
          <tr><td style="padding:28px 32px 0 32px;">
            ${logoHeader()}
          </td></tr>
          <tr><td style="padding:20px 32px 0 32px;">
            <div style="font-size:16px;font-weight:600;color:#1A1C20;">Verify your email</div>
            <p style="font-size:14px;color:#5D6169;line-height:1.6;margin:8px 0 0 0;">
              ${verifyUrl ? 'Click the button below, or enter this code, to finish setting up your Reelytic workspace.' : 'Enter this code to finish setting up your Reelytic workspace.'}
            </p>
          </td></tr>
          ${verifyUrl ? `<tr><td style="padding:24px 32px 0 32px;">
            <a href="${verifyUrl}" style="display:block;background-color:#E23E57;color:#FFFFFF;text-decoration:none;text-align:center;font-size:15px;font-weight:600;padding:14px 20px;border-radius:8px;">
              Verify email
            </a>
          </td></tr>
          <tr><td style="padding:16px 32px 0 32px;" align="center">
            <span style="font-size:12px;color:#8B8F98;">or enter this code</span>
          </td></tr>` : ''}
          <tr><td style="padding:${verifyUrl ? '12px' : '24px'} 32px 0 32px;">
            <div style="background-color:#F7F6F3;border-radius:8px;padding:20px;text-align:center;">
              <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#1A1C20;">${code}</span>
            </div>
          </td></tr>
          <tr><td style="padding:16px 32px 28px 32px;">
            <p style="font-size:12px;color:#8B8F98;line-height:1.6;margin:0;">
              This ${verifyUrl ? 'code and link expire' : 'code expires'} in ${minutes} minutes. If you didn't try to sign up for Reelytic, you can safely ignore this email -- no account will be created without it.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildOtpEmailText({ code, minutes, verifyUrl }) {
  const verifyLine = verifyUrl ? `Verify instantly: ${verifyUrl}\n\nOr enter this code: ${code}` : `Your code: ${code}`;
  return `Verify your email for Reelytic\n\n${verifyLine}\n\nFinish setting up your Reelytic workspace. This expires in ${minutes} minutes.\n\nIf you didn't try to sign up for Reelytic, you can safely ignore this email -- no account will be created without it.`;
}

// Same card shell as the OTP email, with a button in place of the code
// block -- this flow is "click a link", not "type a code".
function buildPasswordResetEmailHtml({ resetUrl, minutes }) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F6F3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F6F3;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:420px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E4E1DA;">
          <tr><td style="padding:28px 32px 0 32px;">
            ${logoHeader()}
          </td></tr>
          <tr><td style="padding:20px 32px 0 32px;">
            <div style="font-size:16px;font-weight:600;color:#1A1C20;">Reset your password</div>
            <p style="font-size:14px;color:#5D6169;line-height:1.6;margin:8px 0 0 0;">
              We received a request to reset the password on your Reelytic account. Click the button below to choose a new one.
            </p>
          </td></tr>
          <tr><td style="padding:24px 32px;">
            <a href="${resetUrl}" style="display:block;background-color:#E23E57;color:#FFFFFF;text-decoration:none;text-align:center;font-size:15px;font-weight:600;padding:14px 20px;border-radius:8px;">
              Reset password
            </a>
          </td></tr>
          <tr><td style="padding:0 32px 12px 32px;">
            <p style="font-size:12px;color:#8B8F98;line-height:1.6;margin:0;word-break:break-all;">
              Or paste this link into your browser: ${resetUrl}
            </p>
          </td></tr>
          <tr><td style="padding:0 32px 28px 32px;">
            <p style="font-size:12px;color:#8B8F98;line-height:1.6;margin:0;">
              This link expires in ${minutes} minutes. If you didn't request a password reset, you can safely ignore this email -- your password won't change.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildPasswordResetEmailText({ resetUrl, minutes }) {
  return `Reset your Reelytic password\n\nWe received a request to reset the password on your Reelytic account. Open this link to choose a new one:\n${resetUrl}\n\nThis link expires in ${minutes} minutes.\n\nIf you didn't request a password reset, you can safely ignore this email -- your password won't change.`;
}

/*
  Sent instead of a reset link when someone runs "forgot password" against
  an email that only has a Google-linked account (no passwordHash to reset).
  Whether we send this or the real reset email is decided before either
  builder is called, but the API response is identical either way ({sent:
  true}) -- see auth.routes.js POST /forgot-password. Only the account's own
  inbox ever sees which one it was, so this can't be used to probe accounts.
*/
function buildGoogleAccountNoticeHtml() {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F6F3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F6F3;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:420px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E4E1DA;">
          <tr><td style="padding:28px 32px 0 32px;">
            ${logoHeader()}
          </td></tr>
          <tr><td style="padding:20px 32px 28px 32px;">
            <div style="font-size:16px;font-weight:600;color:#1A1C20;">No password to reset</div>
            <p style="font-size:14px;color:#5D6169;line-height:1.6;margin:8px 0 0 0;">
              Someone requested a password reset for this email, but this Reelytic account signs in with Google -- there's no password on file to reset. Use the "Continue with Google" button on the login page instead.
            </p>
            <p style="font-size:12px;color:#8B8F98;line-height:1.6;margin:16px 0 0 0;">
              If this wasn't you, no action is needed -- nothing about your account changes from a reset request alone.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildGoogleAccountNoticeText() {
  return `No password to reset\n\nSomeone requested a password reset for this email, but this Reelytic account signs in with Google -- there's no password on file to reset. Use "Continue with Google" on the login page instead.\n\nIf this wasn't you, no action is needed.`;
}

module.exports = {
  sendTransactionalEmail,
  buildOtpEmailHtml,
  buildOtpEmailText,
  buildPasswordResetEmailHtml,
  buildPasswordResetEmailText,
  buildGoogleAccountNoticeHtml,
  buildGoogleAccountNoticeText,
};
