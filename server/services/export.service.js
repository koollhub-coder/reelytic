const ExcelJS = require('exceljs');

const ER_FORMULA_NOTE = 'ER = (Likes + Comments) / Views x 100';

/*
  Creator handle for a spreadsheet cell, or a plain statement that it is not
  known.

  Historic rows store the literal string "undefined" where an upstream actor
  returned no owner (167 of them), so `res.username || ''` happily wrote
  "undefined" into client-facing exports. Both that string and a real absence
  mean the same thing and are handled together. Mirrors creatorLabel() in
  client/src/components/ReportSheet.jsx; keep the two in step.
*/
function creatorCell(username, { withAt = false } = {}) {
  if (username === undefined || username === null) return 'Creator not identified';
  const s = String(username).trim();
  if (s === '' || s === 'undefined' || s === 'null') return 'Creator not identified';
  return withAt ? `@${s}` : s;
}

const CANDIDATE_REASON_LABELS = {
  included: 'Included',
  outlier_high: 'Outlier - too high',
  outlier_low: 'Outlier - too low',
  pinned: 'Pinned',
  not_a_reel: 'Not a Reel',
  not_own: "Not this creator's post",
  sponsored: 'Sponsored / paid partnership',
  collab: 'Collab post',
  missing_views: 'Missing view data',
  beyond_top_6: 'Beyond top 6',
};

// Rows in the export: duplicates are excluded entirely (never scraped, never
// billed -- including them would double-count a creator/reel already in the
// sheet). Invalid/failed rows ARE included so the client can see exactly
// which submitted links didn't make it into the report, with zeroed metrics
// and the raw link -- never a fabricated name.
function exportableRows(job) {
  return job.rows.filter(r => r.state !== 'duplicate');
}

// Job report exports (reel/profile) are meant to be handed straight to a
// client as the deliverable -- no metadata preamble, no Status column, no
// formula footnote. Just the sheet. (The admin per-client ledger export
// below is a different audience/purpose and keeps all of that.)
async function generateExcelExport(job) {
  const workbook = new ExcelJS.Workbook();
  const isReel = job.type === 'reel';
  const rows = exportableRows(job);

  if (isReel) {
    const sheet = workbook.addWorksheet('Reelytic Reel Report');
    const origCols = job.originalColumns || [];

    const headers = [
      'SR No.',
      ...origCols.map(c => c.renamedTo || c.name),
      'Username',
      'Profile URL',
      'Reel URL',
      'Followers',
      'Views',
      'Likes',
      'Comments',
      'Shares',
      'Reposts',
      'Saves',
      'ER (%)'
    ];
    const headerRow = sheet.addRow(headers);
    styleHeaderRow(headerRow);

    let sr = 0;
    rows.forEach((row) => {
      sr += 1;
      const origData = origCols.map(c => row.input.original[c.name] ?? '');
      const isOk = row.state === 'done' && row.result;
      const res = row.result || {};

      const rRow = [
        sr,
        ...origData,
        isOk ? creatorCell(res.username) : '',
        isOk ? (res.profileLink || '') : '',
        isOk ? (res.reelLink || row.input.url) : row.input.url,
        isOk ? (res.followers || 0) : 0,
        isOk ? (res.views || 0) : 0,
        isOk ? (res.likes || 0) : 0,
        isOk ? (res.comments || 0) : 0,
        isOk ? (res.shares || 0) : 0,
        isOk ? (res.reposts || 0) : 0,
        isOk ? (res.saves || 0) : 0,
        isOk ? (res.er || 0) : 0,
      ];
      const addedRow = sheet.addRow(rRow);
      styleDataRow(addedRow, isOk ? 'success' : row.state);
    });

    // Header layout: SR No., ...origCols, Username, Profile URL, Reel URL,
    // Followers, Views, Likes, Comments, Shares, Reposts, Saves, ER (%)
    const base = 1 + origCols.length;
    applyNumberFormats(sheet, {
      thousands: [base + 4, base + 5, base + 6, base + 7, base + 8, base + 9, base + 10],
      percent: [base + 11],
    });
    autoFitColumns(sheet);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  } else {
    const summarySheet = workbook.addWorksheet('Reelytic Profile Report');
    const origCols = job.originalColumns || [];

    const sumHeaders = [
      'SR No.',
      ...origCols.map(c => c.renamedTo || c.name),
      'Username',
      'Profile URL',
      'Followers',
      'Average Views',
      'Average ER (%)',
    ];
    const sumHeaderRow = summarySheet.addRow(sumHeaders);
    styleHeaderRow(sumHeaderRow);

    const breakdownSheet = workbook.addWorksheet('Reel Breakdown');
    const bdHeaders = ['Username', 'Profile URL', 'Reel URL', 'Date', 'Shortcode', 'Views', 'Likes', 'Comments', 'ER (%)', 'Status'];
    const bdHeaderRow = breakdownSheet.addRow(bdHeaders);
    styleHeaderRow(bdHeaderRow);

    let sr = 0;
    rows.forEach((row) => {
      sr += 1;
      const origData = origCols.map(c => row.input.original[c.name] ?? '');
      const isOk = row.state === 'done' && row.result;
      const res = row.result || {};

      const sumRow = [
        sr,
        ...origData,
        isOk ? creatorCell(res.username) : '',
        isOk ? (res.profileLink || '') : '',
        isOk ? (res.followers || 0) : 0,
        isOk ? (res.avgViews || 0) : 0,
        isOk ? (res.avgEr || 0) : 0,
      ];
      const addedSum = summarySheet.addRow(sumRow);
      styleDataRow(addedSum, isOk ? 'success' : row.state);

      if (!isOk) return;

      // Every fetched candidate, not just the ones averaged in -- a client
      // should be able to see exactly which of a creator's recent posts were
      // considered and why each was or wasn't included. Falls back to the
      // older perReel-only shape for results computed before this field existed.
      if (res.candidates && Array.isArray(res.candidates) && res.candidates.length > 0) {
        const perReelByCode = new Map((res.perReel || []).map(r => [r.shortcode, r]));
        res.candidates.forEach(c => {
          const detail = perReelByCode.get(c.shortCode);
          const bdRow = breakdownSheet.addRow([
            creatorCell(res.username),
            res.profileLink || '',
            c.url || '',
            c.timestamp ? new Date(c.timestamp).toLocaleDateString('en-IN') : '',
            c.shortCode || '',
            c.views ?? '',
            detail ? (detail.likes ?? 0) : '',
            detail ? (detail.comments ?? 0) : '',
            detail ? (detail.er ?? 0) : '',
            CANDIDATE_REASON_LABELS[c.reason] || c.reason,
          ]);
          if (!c.included) {
            bdRow.font = { name: 'Inter', size: 10, color: { argb: '9CA3AF' } };
          }
        });
      } else if (res.perReel && Array.isArray(res.perReel)) {
        res.perReel.forEach(reel => {
          breakdownSheet.addRow([
            creatorCell(res.username),
            res.profileLink || '',
            reel.link || '',
            '',
            reel.shortcode || '',
            reel.views || 0,
            reel.likes || 0,
            reel.comments || 0,
            reel.er || 0,
            'Included',
          ]);
        });
      }
    });

    // Header layout: SR No., ...origCols, Username, Profile URL, Followers,
    // Average Views, Average ER (%)
    const sumBase = 1 + origCols.length;
    applyNumberFormats(summarySheet, {
      thousands: [sumBase + 3, sumBase + 4],
      percent: [sumBase + 5],
    });
    autoFitColumns(summarySheet);
    summarySheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Breakdown header layout: Username, Profile URL, Reel URL, Shortcode,
    // Views, Likes, Comments, ER (%)
    // Header layout: Username, Profile URL, Reel URL, Date, Shortcode, Views,
    // Likes, Comments, ER (%), Status
    applyNumberFormats(breakdownSheet, { thousands: [6, 7, 8], percent: [9] });
    autoFitColumns(breakdownSheet);
    breakdownSheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  return await workbook.xlsx.writeBuffer();
}

function generateCsvExport(job) {
  const isReel = job.type === 'reel';
  const origCols = job.originalColumns || [];
  const rows = exportableRows(job);

  const headers = isReel
    ? ['SR No.', ...origCols.map(c => c.renamedTo || c.name), 'Username', 'Profile URL', 'Reel URL', 'Followers', 'Views', 'Likes', 'Comments', 'Shares', 'Reposts', 'Saves', 'ER (%)']
    : ['SR No.', ...origCols.map(c => c.renamedTo || c.name), 'Username', 'Profile URL', 'Followers', 'Average Views', 'Average ER (%)'];

  const csvRow = (vals) => vals.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';

  let csv = csvRow(headers);
  let sr = 0;

  rows.forEach((row) => {
    sr += 1;
    const origData = origCols.map(c => row.input.original[c.name] ?? '');
    const isOk = row.state === 'done' && row.result;
    const res = row.result || {};

    const line = isReel
      ? [sr, ...origData, isOk ? creatorCell(res.username) : '', isOk ? (res.profileLink || '') : '', isOk ? (res.reelLink || row.input.url) : row.input.url, isOk ? (res.followers || 0) : 0, isOk ? (res.views || 0) : 0, isOk ? (res.likes || 0) : 0, isOk ? (res.comments || 0) : 0, isOk ? (res.shares || 0) : 0, isOk ? (res.reposts || 0) : 0, isOk ? (res.saves || 0) : 0, isOk ? (res.er || 0) : 0]
      : [sr, ...origData, isOk ? creatorCell(res.username) : '', isOk ? (res.profileLink || '') : '', isOk ? (res.followers || 0) : 0, isOk ? (res.avgViews || 0) : 0, isOk ? (res.avgEr || 0) : 0];

    csv += csvRow(line);
  });

  return csv;
}

// Admin per-client export: every link ever submitted by this client (across
// all their jobs), from the submittedLinks ledger rather than a single job
// doc -- ledger.service.js stamps resolvedUsername + a flattened metrics
// snapshot on every entry (see recordLedgerEntry), so no join back to the
// original job is needed here.
function clientLedgerHeaders() {
  return ['#', 'Date', 'Type', 'Result', 'Username', 'Submitted URL', 'Views', 'Likes', 'Comments', 'Shares', 'Reposts', 'Saves', 'ER (%)', 'Followers'];
}

function clientLedgerRow(entry, idx) {
  const m = entry.metrics || {};
  const dateStr = entry.at ? new Date(entry.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return [
    idx + 1,
    dateStr,
    entry.type === 'profile' ? 'Profile' : 'Reel',
    entry.result === 'success' ? 'Success' : (entry.result === 'invalid' ? 'Invalid' : 'Failed'),
    entry.resolvedUsername || '',
    entry.url || '',
    m.views || 0,
    m.likes || 0,
    m.comments || 0,
    m.shares || 0,
    m.reposts || 0,
    m.saves || 0,
    m.er || 0,
    m.followers || 0,
  ];
}

async function generateClientLedgerExcel(username, entries) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Reelytic - ${username}`.slice(0, 31));

  const successCount = entries.filter(e => e.result === 'success').length;
  writeMetadataBlock(sheet, {
    title: `Reelytic - ${username}'s links`,
    generatedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    counts: { total: entries.length, success: successCount, failed: entries.length - successCount, invalid: 0, duplicates: 0 },
    procTime: null,
  });

  const headerRowIndex = sheet.lastRow.number + 1;
  const headerRow = sheet.addRow(clientLedgerHeaders());
  styleHeaderRow(headerRow);

  entries.forEach((entry, idx) => {
    const row = sheet.addRow(clientLedgerRow(entry, idx));
    styleDataRow(row, entry.result === 'success' ? 'success' : 'failed');
  });

  applyNumberFormats(sheet, { thousands: [7, 8, 9, 10, 11, 12, 14], percent: [13] });
  writeFooter(sheet);
  autoFitColumns(sheet);
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  return await workbook.xlsx.writeBuffer();
}

/*
  The branded report's own table, and only that -- the creator breakdown a
  client actually sees on the shared page, not the full original sheet with
  every column they uploaded. Feeds the Download Excel button on the public
  share view, so the person receiving the link can take the numbers away
  without asking the agency to re-export anything.
*/
async function generateSharedReportExcel({ job, branding }) {
  const isReel = job.type === 'reel';
  // No username requirement: a row that measured a real reel belongs in the
  // export even when its creator never resolved. It is labelled, not dropped.
  const rows = (job.rows || []).filter((r) => r.state === 'done' && r.result);
  const agency = (branding && branding.agencyName) || 'Reelytic';

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report'.slice(0, 31));

  const titleRow = sheet.addRow([job.fileName || (isReel ? 'Reel Report' : 'Profile Report')]);
  titleRow.font = { bold: true, size: 14, name: 'Inter', color: { argb: 'C4225A' } };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 6);

  const preparedOn = new Date(job.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const metaRow = sheet.addRow([`Prepared by ${agency} on ${preparedOn} - ${rows.length} ${isReel ? 'reels' : 'profiles'} analyzed`]);
  metaRow.font = { size: 10, name: 'Inter', color: { argb: '6B7280' } };
  sheet.mergeCells(metaRow.number, 1, metaRow.number, 6);
  sheet.addRow([]);

  const headers = isReel
    ? ['Creator', 'Followers', 'Views', 'Likes', 'Comments', 'Engagement rate']
    : ['Creator', 'Followers', 'Avg views', 'Engagement rate'];

  const headerRowIndex = sheet.lastRow.number + 1;
  styleHeaderRow(sheet.addRow(headers));

  rows.forEach((r) => {
    const res = r.result;
    /*
      The rate goes in AS STORED, not divided by 100.

      applyNumberFormats uses '0.00"%"', where the % is a quoted literal. That
      appends a percent sign without Excel's usual multiply-by-100, so the cell
      must already hold the percentage figure itself. Dividing first turned a
      real 2.1% into 0.02% in every downloaded sheet while the on-screen report
      still read 2.1%, which is the kind of mismatch that makes a client
      distrust both numbers. Every other export in this file passes the raw
      value; this one now matches.
    */
    const er = (isReel ? res.er : res.avgEr) ?? 0;
    const values = isReel
      ? [creatorCell(res.username, { withAt: true }), res.followers ?? 0, res.views ?? 0, res.likes ?? 0, res.comments ?? 0, er]
      : [creatorCell(res.username, { withAt: true }), res.followers ?? 0, res.avgViews ?? 0, er];
    styleDataRow(sheet.addRow(values), 'success');
  });

  applyNumberFormats(sheet, isReel ? { thousands: [2, 3, 4, 5], percent: [6] } : { thousands: [2, 3], percent: [4] });
  writeFooter(sheet);
  autoFitColumns(sheet);
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  return await workbook.xlsx.writeBuffer();
}

function generateClientLedgerCsv(username, entries) {
  const csvRow = (vals) => vals.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
  let csv = csvRow(clientLedgerHeaders());
  entries.forEach((entry, idx) => { csv += csvRow(clientLedgerRow(entry, idx)); });
  csv += '\n';
  csv += csvRow([`Generated by Reelytic on ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} for ${username}`]);
  csv += csvRow([ER_FORMULA_NOTE]);
  return csv;
}

function writeMetadataBlock(sheet, { title, generatedAt, counts, procTime }) {
  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 14, name: 'Inter', color: { argb: 'C4225A' } };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 4);

  const metaParts = [
    `Generated ${generatedAt}`,
    `Items: ${counts.total}`,
    `Success: ${counts.success}`,
    `Failed/Invalid: ${(counts.failed || 0) + (counts.invalid || 0)}`,
    `Duplicates excluded: ${counts.duplicates || 0}`,
  ];
  if (procTime) metaParts.push(`Processing time: ${procTime}`);
  const metaRow = sheet.addRow([metaParts.join('   •   ')]);
  metaRow.font = { size: 9, name: 'Inter', color: { argb: '5B5F66' } };
  sheet.mergeCells(metaRow.number, 1, metaRow.number, 4);

  sheet.addRow([]);
}

function writeFooter(sheet) {
  sheet.addRow([]);
  const note = sheet.addRow([ER_FORMULA_NOTE]);
  note.font = { italic: true, size: 9, name: 'Inter', color: { argb: '5B5F66' } };
}

// Applies number formatting to absolute (1-based) column indices computed by
// each call site from its own known header layout.
function applyNumberFormats(sheet, { thousands = [], percent = [] } = {}) {
  for (const colIdx of thousands) sheet.getColumn(colIdx).numFmt = '#,##0';
  for (const colIdx of percent) sheet.getColumn(colIdx).numFmt = '0.00"%"';
}

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: '1A1C20' }, name: 'Inter', size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FBE9EC' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 24;
}

function styleDataRow(row, state) {
  row.font = { name: 'Inter', size: 10 };
  if (state === 'invalid' || state === 'failed') {
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FBE7E7' } };
  }
}

function autoFitColumns(sheet) {
  sheet.columns.forEach(column => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, cell => {
      const columnLength = cell.value ? String(cell.value).length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = Math.min(Math.max(maxLength + 3, 12), 45);
  });
}

module.exports = { generateExcelExport, generateCsvExport, generateClientLedgerExcel, generateClientLedgerCsv, generateSharedReportExcel };
