/*
  Reelytic has two engagement rates and they are not the same measure:
  - a Reel's ER divides by that Reel's views
  - a Profile's average ER divides by the creator's followers
  They used to share one label ("ER"), which invited comparing them directly.
  Every surface (tables, exports, portal, PDF, methodology pages) now names
  the denominator. Keep this wording in step with server/services/export.service.js.
*/
export const ER_VIEWS = 'ER % (views)';
export const ER_VIEWS_AVG = 'Avg ER % (views)';
export const ER_FOLLOWERS = 'Avg ER % (followers)';

// The label for a report type's headline ER column.
export function erLabel(type) {
  return type === 'profile' ? ER_FOLLOWERS : ER_VIEWS;
}

// Short form for running text next to a value: "4.7% ER (views)".
export function erShort(type) {
  return type === 'profile' ? 'ER (followers)' : 'ER (views)';
}

// The label for an average taken across a report's rows.
export function erAvgLabel(type) {
  return type === 'profile' ? ER_FOLLOWERS : ER_VIEWS_AVG;
}
