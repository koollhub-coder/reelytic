// Plain-language formula/field descriptions ONLY -- no actor names, no
// costs, no pipeline/vendor labels, no words that hint at how the data is
// gathered ("scrape," "scan," "fetch," etc.). Same pattern as
// profileMethodology.js. Reel reports show one row per submitted Reel (no
// averaging or outlier selection like Profile reports do), so this content
// is simpler -- mostly "what does this column mean."

export const REEL_METHODOLOGY = {
  erFormula: {
    heading: 'Engagement rate formula',
    body: 'ER = (Likes + Comments) ÷ Views × 100',
  },
  whatEachColumnMeans: {
    heading: 'What each column shows',
    body: 'Views, likes, and comments come straight from the Reel. Shares, reposts, and saves show up whenever Instagram makes them public for that Reel. When they\'re not available, we leave the field blank rather than guess.',
  },
  followers: {
    heading: 'Followers column',
    body: 'The creator\'s follower count at the time this report ran, shown for context. It isn\'t part of the ER formula above: engagement rate is based on that Reel\'s own views, not on follower count.',
  },
  scope: {
    heading: 'What this report does not do',
    body: 'A Reel report covers exactly the links you give us, one row per Reel. Nothing added, nothing averaged. If you want a creator-level average across several Reels with outliers handled for you, that\'s what a Profile report is for.',
  },
};
