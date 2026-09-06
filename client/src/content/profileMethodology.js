// Plain-language formula/rule text ONLY -- no actor names, no costs, no
// pipeline/vendor labels. Shared verbatim by the client-facing modal and the
// admin-facing page so the two views never drift apart, but the two
// components themselves stay separate (see ProfileMethodologyModal.jsx vs
// admin/ProfileMethodology.jsx) -- this file must never be imported
// alongside settings/cost data in the client-facing component.

// Two variants exist because the underlying calculation genuinely differs
// (see selectProfileReels vs selectProfileReelsV2, computeProfileMetrics vs
// computeProfileMetricsV2 on the server) -- 'standard' and 'refined' are
// calculation-only labels, never a vendor/pipeline/cost name. Which variant
// a given report used travels with that report's own result data
// (`calcVariant`), so this always describes how THAT report was actually
// calculated, not just whichever method happens to be active today.
export const PROFILE_METHODOLOGY = {
  // FIXED 2026-09-06: this used to read '÷ Views' -- a copy-paste of the
  // Reel-report formula (server/services/metrics.service.js
  // computeReelMetrics, which genuinely IS per-view). The Profile-report
  // number computeProfileMetrics()/computeProfileMetricsV2() actually
  // produces divides by FOLLOWERS, not views. That's not a rounding
  // difference -- it's a different metric (engagement per follower, the
  // standard way to compare creators of different sizes, vs. engagement
  // per view, which only makes sense for a single post). Showing the Reel
  // formula here meant this page's own promise -- "check the maths
  // yourself" -- was uncheckable for every single Profile report: a reader
  // following it exactly would land on a different number than the report
  // shows. Keep this in sync with metrics.service.js if that ever changes.
  erFormula: {
    heading: 'Engagement rate formula',
    body: 'ER = (Avg. Likes + Avg. Comments) ÷ Followers × 100',
  },
  // Called out separately from the formula itself because the difference
  // from a Reel report's formula is the exact thing worth a reader's
  // attention -- the two numbers are not the same kind of metric and were
  // never meant to be compared to each other directly.
  erNote: 'This divides by the creator\'s FOLLOWER count, not views -- '
    + 'unlike a Reel report\'s engagement rate, which is per-view. A '
    + 'Profile report\'s ER measures engagement relative to audience size '
    + '(the standard way to compare creators of different sizes to each '
    + 'other); a Reel report\'s ER measures one post\'s performance '
    + 'relative to who actually saw it. The two numbers answer different '
    + 'questions and aren\'t meant to be compared to each other directly.',
  sortOrder: {
    standard: {
      heading: 'Which Reels we look at',
      body: 'This creator\'s 6 most recent Reels that qualify (see "What we leave out" below).',
    },
    refined: {
      heading: 'Which Reels we look at',
      body: 'This creator\'s most recent Reels that qualify. Usually 6, sometimes a couple more or fewer depending on how much they\'ve posted.',
    },
  },
  outlierRule: {
    standard: {
      heading: 'Keeping the average honest',
      body: 'If a Reel did way better or way worse than this creator usually does, we leave it out of the average. One viral hit or one flop shouldn\'t decide the whole number.',
    },
    refined: {
      heading: 'Keeping the average honest',
      body: 'Reels that did way better or way worse than this creator usually does count for less in the average, and the most extreme ones are left out entirely. One viral hit or one flop shouldn\'t decide the whole number.',
    },
  },
  exclusions: {
    heading: 'What we leave out',
    body: 'Pinned posts, anything that isn\'t a Reel (photos, carousels), posts where this creator is just tagged rather than the one who posted it, and Reels marked as a paid partnership, sponsored, or a joint Collab with another account. Only this creator\'s own, organic Reels count toward the average.',
  },
  // A concrete, checkable walkthrough, not just a description of the rule --
  // exact numbers so a client can redo the arithmetic themselves and land on
  // the same figure. views chosen so the "normal" pool lands on exactly 6
  // (the target), so nothing here needs backfill to explain. likes/comments
  // and a follower count were added alongside the ÷followers formula fix
  // above specifically so this example can walk through the ER calculation
  // itself, not just average views -- the whole point of a worked example
  // is to let someone actually check the number that used to be
  // uncheckable.
  workedExample: {
    heading: 'A worked example',
    intro: 'Say a creator with 50,000 followers has posted 12 times recently. Here\'s exactly how those 12 posts turn into one Profile report.',
    followers: 50000,
    posts: [
      { label: 'Pinned welcome video', views: 210000, reason: 'Pinned' },
      { label: 'Skincare brand reel, marked "Paid partnership"', views: 38000, reason: 'Sponsored / paid partnership' },
      { label: 'Reel co-posted with another creator', views: 41000, reason: 'Collab post' },
      { label: 'Behind-the-scenes carousel (photos, not a Reel)', views: null, reason: 'Not a Reel' },
      { label: 'Reel', views: 22000, likes: 900, comments: 40, reason: null },
      { label: 'Reel', views: 25000, likes: 1100, comments: 55, reason: null },
      { label: 'Reel', views: 19000, likes: 800, comments: 35, reason: null },
      { label: 'Reel', views: 28000, likes: 1200, comments: 60, reason: null },
      { label: 'Reel', views: 21000, likes: 950, comments: 45, reason: null },
      { label: 'Reel', views: 24000, likes: 1050, comments: 50, reason: null },
      { label: 'Reel that unexpectedly went viral', views: 95000, reason: 'Outlier, too high' },
      { label: 'Reel that barely got seen', views: 3000, reason: 'Outlier, too low' },
    ],
    outcome: 'That leaves 6 ordinary Reels: 22,000, 25,000, 19,000, 28,000, 21,000, and 24,000 views. Average views = (22,000 + 25,000 + 19,000 + 28,000 + 21,000 + 24,000) ÷ 6 = 23,167. That number, not the 210K pinned post or the 95K viral one, is what the report shows as this creator\'s typical performance.',
    // Separate from `outcome` on purpose: the views walkthrough and the ER
    // walkthrough are two different calculations (one straightforward
    // average, one that also brings in followers), and folding both into
    // one paragraph is exactly how the old version of this page made the
    // ÷followers step easy to skim past.
    erOutcome: 'Those same 6 Reels averaged 1,000 likes and 47.5 comments. Engagement rate = (1,000 + 47.5) ÷ 50,000 followers × 100 = 2.1%. Notice the denominator: it\'s the creator\'s follower count, not their view count -- the same 6 Reels would produce a very different-looking number if this were calculated the way a Reel report is.',
  },
};
