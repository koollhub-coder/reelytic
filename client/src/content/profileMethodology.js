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
  erFormula: {
    heading: 'Engagement rate formula',
    body: 'ER = (Likes + Comments) ÷ Views × 100',
  },
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
  // (the target), so nothing here needs backfill to explain.
  workedExample: {
    heading: 'A worked example',
    intro: 'Say a creator has posted 12 times recently. Here\'s exactly how those 12 posts turn into one Profile report.',
    posts: [
      { label: 'Pinned welcome video', views: 210000, reason: 'Pinned' },
      { label: 'Skincare brand reel, marked "Paid partnership"', views: 38000, reason: 'Sponsored / paid partnership' },
      { label: 'Reel co-posted with another creator', views: 41000, reason: 'Collab post' },
      { label: 'Behind-the-scenes carousel (photos, not a Reel)', views: null, reason: 'Not a Reel' },
      { label: 'Reel', views: 22000, reason: null },
      { label: 'Reel', views: 25000, reason: null },
      { label: 'Reel', views: 19000, reason: null },
      { label: 'Reel', views: 28000, reason: null },
      { label: 'Reel', views: 21000, reason: null },
      { label: 'Reel', views: 24000, reason: null },
      { label: 'Reel that unexpectedly went viral', views: 95000, reason: 'Outlier, too high' },
      { label: 'Reel that barely got seen', views: 3000, reason: 'Outlier, too low' },
    ],
    outcome: 'That leaves 6 ordinary Reels: 22,000, 25,000, 19,000, 28,000, 21,000, and 24,000 views. Average views = (22,000 + 25,000 + 19,000 + 28,000 + 21,000 + 24,000) ÷ 6 = 23,167. That number, not the 210K pinned post or the 95K viral one, is what the report shows as this creator\'s typical performance. Likes and comments for those same 6 Reels get averaged the same way to produce the average engagement rate.',
  },
};
