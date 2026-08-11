/*
  Plain-English names for things that are stored as internal codes.

  The database records a scan method as "v2", "legacy", "express" or
  "standard" because those are what the code branches on. None of that means
  anything to a person reading a spend report, so nothing internal should
  reach a screen: the admin pages ask for a label here instead.

  Profile reports and reel reports happen to use different words internally
  for the same two ideas ("legacy"/"v2" vs "standard"/"express"), which is
  exactly the sort of thing that should be flattened before display rather
  than explained in a tooltip.
*/

export function scanMethodLabel(mode) {
  switch (mode) {
    case 'v2':
    case 'express':
      return 'Express scan';
    case 'legacy':
    case 'standard':
      return 'Standard scan';
    default:
      return 'Standard scan';
  }
}

export function scanMethodHelp(mode) {
  switch (mode) {
    case 'v2':
    case 'express':
      return 'One combined lookup per creator. Around a third cheaper than the standard scan, same figures.';
    case 'legacy':
    case 'standard':
      return 'Two separate lookups per creator, one for the posts and one for the follower count. The original method, and the dearer one.';
    default:
      return 'The scan method recorded for this item.';
  }
}

/*
  Where a cost figure came from, in words rather than codes. The distinction
  matters because "we were billed this" and "this is our rate card" are
  different levels of certainty, and a free item is only free because we
  reused something we already had.
*/
export function costSourceLabel(source, agePhrase) {
  switch (source) {
    case 'cached':
      return agePhrase ? `Reused, ${agePhrase}` : 'Reused from earlier';
    case 'measured':
      return 'Exact billed amount';
    case 'estimated':
      return 'Our standard rate';
    case 'backfilled':
      return 'Estimated, before cost tracking';
    default:
      return 'Our standard rate';
  }
}

export function costSourceHelp(source) {
  switch (source) {
    case 'cached':
      return 'We already held this data, so no scrape was made and nothing was spent. The age tells you how current the figures are.';
    case 'measured':
      return 'The real amount charged for the run that produced this item, read back from the billing API.';
    case 'estimated':
      return 'Our measured per-item rate for whichever scan method was active. Real spend is billed across the whole account, not per item.';
    case 'backfilled':
      return 'This item was recorded before per-item cost tracking existed, so a flat rate has been applied.';
    default:
      return '';
  }
}
