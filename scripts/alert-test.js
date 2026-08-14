/*
  Proves the alerting credentials and sender actually work, before anything
  depends on them. Run with: npm run alert:test
*/
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { sendTestAlert, isConfigured, slackConfigured, emailConfigured } = require('../server/services/alerting.service');

(async () => {
  console.log('Slack configured:', slackConfigured());
  console.log('Email configured:', emailConfigured());
  const result = await sendTestAlert();
  console.log(JSON.stringify(result, null, 1));
  if (result.sent) {
    // Reported per channel: a working Slack must not be hidden behind a
    // broken email setup, nor the reverse.
    if (result.slack.sent) console.log('\nSlack: delivered to your alerts channel.');
    if (result.email.sent) console.log(`Email: delivered to ${result.email.to} (check spam too).`);
    if (!result.slack.sent && slackConfigured()) {
      console.log('Slack FAILED:', result.slack.hint || result.slack.detail || result.slack.reason);
    }
    if (!result.email.sent && emailConfigured()) {
      console.log('Email FAILED:', result.email.hint || result.email.detail || result.email.reason);
    }
    if (!slackConfigured()) console.log('Slack: not set up yet (add SLACK_WEBHOOK_URL to the root .env).');
  } else {
    console.log('\nNOT SENT.');
    if (result.hint) console.log('Likely cause:', result.hint);
    if (result.reason === 'not-configured') {
      console.log('Add at least one of these to the .env in the PROJECT ROOT:');
      console.log('  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...');
      console.log('  RESEND_API_KEY=re_...  +  ALERT_EMAIL_TO=you@example.com');
    }
  }
  // Set the code and let Node exit naturally. process.exit() here races the
  // still-closing HTTPS handle and Windows prints a libuv assertion that
  // looks like a crash but is only an abrupt teardown.
  process.exitCode = result.sent ? 0 : 1;
})();
