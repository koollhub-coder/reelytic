/*
  Small helpers for showing a report the same way everywhere (History, the
  dashboard, anywhere a report is listed).
*/

// Pasted lists are all saved as "pasted-links.txt", which makes forty of them
// impossible to tell apart in a list. A plain name reads better, and a name the
// person typed on the upload screen is shown exactly as typed.
export const displayName = (job) => (!job || !job.fileName || job.fileName === 'pasted-links.txt' ? (job && job.type === 'profile' ? 'Profile report' : 'Reel report') : job.fileName);

// Where "open this report" goes. Always includes the report's id: without it the
// page opens on an empty upload screen instead of the report.
export const reportPath = (job) => `${job.type === 'reel' ? '/reels' : '/profiles'}?job=${job.id}`;
