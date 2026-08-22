/*
  Admin-editable legal documents (Terms of Service, Privacy Policy).

  Stored in the existing `settings` collection under the same {key, value}
  shape every other admin-tunable setting already uses (pricingPlans,
  costModel, pipeline modes, etc -- see db.js for the unique index on `key`).
  No new collection needed.

  The content below is the live default shown until an admin first edits it
  from /admin/legal. It is a real, product-accurate first draft written from
  what Reelytic actually does (credits, Apify-sourced public Instagram data,
  Razorpay billing, Google sign-in, branded share links) -- not boilerplate.
  It is not a substitute for review by an actual lawyer before this app takes
  paying customers; the one concrete legal fact assumed here (India as the
  governing jurisdiction) is inferred from Razorpay + APP_TIMEZONE=Asia/Kolkata
  and should be confirmed, not taken as authoritative.
*/

const { getDb } = require('../db');

const TYPES = ['terms', 'privacy'];

function keyFor(type) {
  return `legal:${type}`;
}

const DEFAULT_CONTENT = {
  terms: `## 1. Agreement to these Terms
These Terms of Service ("Terms") govern your access to and use of Reelytic (the "Service"), an analytics tool that turns a list of Instagram Reel or profile links into engagement reports. By creating an account or using the Service you agree to these Terms. If you are using Reelytic on behalf of an agency or business, you are agreeing on that organization's behalf and confirming you have the authority to do so.

## 2. What Reelytic does
You upload or paste a sheet of Instagram Reel or profile links. Reelytic retrieves publicly available metrics for those links (views, likes, comments, followers, and engagement rate) through third-party data-collection services, and assembles the results into a downloadable and shareable report. Some figures shown (such as certain averages or estimates) are statistical estimates rather than numbers read directly off Instagram, and the Service labels these as estimates where applicable.

## 3. Accounts
You must provide an accurate email address and complete email verification to activate a self-service account. You are responsible for keeping your password confidential and for all activity that happens under your account. Reelytic also offers sign-in with Google; if you use it, your account is linked to the email address your Google account provides. Accounts are for a single person or a single organization's team, not for resale or sharing of login credentials across unrelated parties.

## 4. Credits and plans
New accounts start with a limited number of free credits. Processing a link consumes credits according to the plan and pricing in effect at the time. Paid plans and any credit top-ups are billed through our payment processor (Razorpay); Reelytic does not receive or store your full card number. Credits are generally non-refundable once consumed, except where required by applicable law. Pricing and credit costs may change; material changes will be reflected on the Pricing page.

## 5. Acceptable use
You agree not to:
- Create multiple accounts, or use disposable/temporary email addresses, to obtain free credits beyond what is offered to a genuine single user or organization
- Use the Service to collect or process data you do not have a legitimate right to analyze, or to harass, stalk, or build profiles on private individuals
- Attempt to scrape, reverse-engineer, or overload Reelytic's own infrastructure outside of normal use of the Service
- Share, sell, sublicense, or resell your account access without our written agreement
- Use the Service in a way that violates Instagram's own terms of use, or applicable law in your jurisdiction

We may suspend or disable accounts that violate this section, including accounts created to abuse the free-credit system.

## 6. Data sources and Instagram
Reelytic is an independent tool and is not affiliated with, endorsed by, or sponsored by Instagram or Meta Platforms, Inc. The Service only processes publicly available Reel and profile data; it does not ask for or use your Instagram login credentials, and it cannot access private accounts or direct messages. You are responsible for ensuring your own use of the data you retrieve complies with applicable law and any third-party terms that apply to you.

## 7. Branded reports and share links
Reelytic lets you brand a report with your own agency name, logo, and accent color, and generate a link so a client can view or download it without a Reelytic account. Anyone who has that link can view the report until you disable or it expires. You are responsible for choosing who you share a link with; Reelytic is not responsible for a report reaching someone you shared the link with directly or indirectly.

## 8. Payments
Paid plans are billed through Razorpay. By subscribing you authorize the applicable charge for your selected plan. You can view your credit and plan history at any time from your account. Contact us before disputing a charge with your bank or card issuer so we can look into it directly.

## 9. Termination
You may stop using the Service and ask us to delete your account at any time (see the Privacy Policy for how). We may suspend or terminate an account that violates these Terms, is used fraudulently, or is inactive for an extended period, with notice where reasonably possible.

## 10. Disclaimers
The Service is provided "as is." Metrics retrieved from Instagram depend on third-party data-collection services and on Instagram's own platform, both of which can change or be temporarily unavailable; Reelytic does not guarantee uninterrupted access or perfect accuracy of every figure. Estimated metrics are clearly the product of statistical modeling, not a direct read of Instagram's own numbers, and should be treated accordingly.

## 11. Limitation of liability
To the fullest extent permitted by law, Reelytic and its operators are not liable for indirect, incidental, or consequential damages arising from your use of the Service, including decisions made based on report data. Our total liability for any claim relating to the Service is limited to the amount you paid us in the twelve months before the claim arose.

## 12. Changes to these Terms
We may update these Terms from time to time. Material changes will update the "last updated" date shown on this page. Continuing to use the Service after a change takes effect means you accept the updated Terms.

## 13. Governing law
These Terms are governed by the laws of India, and any dispute arising from them will be subject to the exclusive jurisdiction of the courts located in India, without regard to conflict-of-law principles.

## 14. Contact
Questions about these Terms can be sent to support@reelytic.com.`,

  privacy: `## 1. Overview
This Privacy Policy explains what information Reelytic collects, why, and how it is used when you create an account, submit links for analysis, and use reports. It applies to the Reelytic web application and its API.

## 2. Information we collect
- Account information: username, email address, and a securely hashed password (we never store your password in plain text). If you sign in with Google, we receive the name and email address your Google account shares with us.
- Verification data: a short-lived, hashed one-time code sent to your email to confirm you own it before your account is activated.
- Usage data: the links you submit for processing, the reports and campaigns you create, credits used, and report-branding settings you configure (agency name, logo, accent color).
- Technical and security data: IP address, browser/device information, and login timestamps, used to protect your account (for example, to rate-limit repeated failed logins and keep a login history you can review).
- Payment data: handled directly by our payment processor, Razorpay. Reelytic does not receive or store your full card number.

## 3. How we use this information
- To operate the Service: process the links you submit, generate and store your reports, and track your credit balance
- To secure your account: send email verification codes, detect suspicious login activity, and let an administrator revoke a compromised session
- To communicate with you: transactional emails such as verification codes and account-related notices (not marketing email unless you separately opt in, if that ever becomes available)
- To improve the Service: understand aggregate usage patterns so we can prioritize what to build next

## 4. Third-party service providers
Reelytic uses a small number of infrastructure providers ("subprocessors") to operate the Service, each of which only receives the data it needs to do its job:
- MongoDB Atlas -- hosts our database (accounts, reports, credits, settings)
- Apify -- runs the data-collection actors that retrieve public Instagram metrics for the links you submit; it receives only the Instagram usernames/links you submit for processing, not your Reelytic account credentials
- Resend -- delivers transactional email (verification codes, account notices)
- Google -- provides "Continue with Google" sign-in, if you choose to use it
- Razorpay -- processes payments for paid plans

We do not sell your personal information, and we do not use advertising trackers.

## 5. Data from Instagram
Reelytic only retrieves publicly available Reel and profile metrics. We do not request your Instagram password, do not access private accounts, and do not read direct messages. The Instagram usernames and links you choose to submit are processed solely to generate your report.

## 6. Cookies
Reelytic uses a single essential session cookie to keep you signed in. It is not used for advertising or cross-site tracking, and we do not load third-party advertising or analytics trackers that follow you across other sites.

## 7. Data retention
We keep your account, reports, and campaign data for as long as your account is active. If you delete your account, we delete or anonymize this data within a reasonable period, except where we are required to keep certain records (for example, billing records) for legal or accounting purposes.

## 8. Your rights
You can review and update most of your own information from Settings at any time. You can request a copy of your account data, ask us to correct it, or ask us to delete your account and associated data, by contacting support@reelytic.com. We will respond within a reasonable time and may need to verify your identity first.

## 9. Data security
Passwords are hashed, never stored in plain text. Email verification codes are hashed and expire automatically. Administrators can revoke an individual session if an account is believed to be compromised. No method of transmission or storage is 100% secure, but we take reasonable, industry-standard measures to protect your data.

## 10. Children's privacy
Reelytic is intended for business and professional use and is not directed at children. We do not knowingly collect personal information from anyone under 18. If you believe a child has provided us with personal information, contact us and we will remove it.

## 11. Reports you share
When you generate a branded report link to share with your own client, the data in that report becomes visible to anyone who has the link, for as long as the link is active. That sharing choice, and who you send the link to, is yours to control; Reelytic is not responsible for a link being forwarded further by its recipient.

## 12. International data
Our infrastructure providers may process and store data outside your own country. By using the Service you consent to your data being processed in the locations where these providers operate.

## 13. Changes to this policy
We may update this Privacy Policy from time to time. Material changes will update the "last updated" date shown on this page.

## 14. Contact
Questions about this Privacy Policy can be sent to support@reelytic.com.`,
};

async function getLegalDoc(type) {
  if (!TYPES.includes(type)) return null;
  const db = getDb();
  const doc = await db.collection('settings').findOne({ key: keyFor(type) });
  if (doc) return doc.value;
  return { content: DEFAULT_CONTENT[type], version: 1, updatedAt: null, updatedBy: null };
}

async function updateLegalDoc(type, content, adminUsername) {
  if (!TYPES.includes(type)) {
    const err = new Error('Unknown legal document type.');
    err.status = 400;
    throw err;
  }
  const db = getDb();
  const existing = await db.collection('settings').findOne({ key: keyFor(type) });
  const nextVersion = existing ? (existing.value.version || 1) + 1 : 2;
  const value = { content, version: nextVersion, updatedAt: new Date(), updatedBy: adminUsername };
  await db.collection('settings').updateOne(
    { key: keyFor(type) },
    { $set: { key: keyFor(type), value } },
    { upsert: true }
  );
  return value;
}

module.exports = { getLegalDoc, updateLegalDoc, TYPES };
