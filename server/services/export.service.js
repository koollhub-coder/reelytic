const ExcelJS = require('exceljs');

async function generateExcelExport(job) {
  const workbook = new ExcelJS.Workbook();
  const isReel = job.type === 'reel';

  if (isReel) {
    const sheet = workbook.addWorksheet('Reel Report');
    const origCols = job.originalColumns || [];

    const headers = [
      'SR No.',
      ...origCols.map(c => c.renamedTo || c.name),
      'Name',
      'Profile Link',
      'Followers',
      'Reel Link',
      'Views',
      'Likes',
      'Comments',
      'Shares',
      'Reposts',
      'Saves',
      'Engagement Rate (%)'
    ];

    sheet.addRow(headers);
    styleHeaderRow(sheet.getRow(1));

    job.rows.forEach((row, idx) => {
      const origData = origCols.map(c => row.input.original[c.name] ?? '');
      const res = row.result || {};
      const rRow = [
        idx + 1,
        ...origData,
        res.name || '',
        res.profileLink || '',
        res.followers !== undefined ? res.followers : '',
        res.reelLink || row.input.url,
        res.views !== undefined ? res.views : '',
        res.likes !== undefined ? res.likes : '',
        res.comments !== undefined ? res.comments : '',
        res.shares !== undefined ? res.shares : '',
        res.reposts !== undefined ? res.reposts : '',
        res.saves !== undefined ? res.saves : '',
        res.er !== undefined ? res.er : ''
      ];
      const addedRow = sheet.addRow(rRow);
      styleDataRow(addedRow, row.state);
    });

    autoFitColumns(sheet);
  } else {
    const summarySheet = workbook.addWorksheet('Profile Summary');
    const origCols = job.originalColumns || [];

    const sumHeaders = [
      'SR No.',
      ...origCols.map(c => c.renamedTo || c.name),
      'Name',
      'Profile Link',
      'Followers',
      'Average Views',
      'Average ER (%)'
    ];
    summarySheet.addRow(sumHeaders);
    styleHeaderRow(summarySheet.getRow(1));

    const breakdownSheet = workbook.addWorksheet('Reel Breakdown');
    const bdHeaders = ['Profile Name', 'Profile Link', 'Reel Link', 'Shortcode', 'Views', 'Likes', 'Comments', 'Engagement Rate (%)'];
    breakdownSheet.addRow(bdHeaders);
    styleHeaderRow(breakdownSheet.getRow(1));

    job.rows.forEach((row, idx) => {
      const origData = origCols.map(c => row.input.original[c.name] ?? '');
      const res = row.result || {};
      const sumRow = [
        idx + 1,
        ...origData,
        res.name || '',
        res.profileLink || '',
        res.followers !== undefined ? res.followers : '',
        res.avgViews !== undefined ? res.avgViews : '',
        res.avgEr !== undefined ? res.avgEr : ''
      ];
      const addedSum = summarySheet.addRow(sumRow);
      styleDataRow(addedSum, row.state);

      if (res.perReel && Array.isArray(res.perReel)) {
        res.perReel.forEach(reel => {
          breakdownSheet.addRow([
            res.name || '',
            res.profileLink || '',
            reel.link || '',
            reel.shortcode || '',
            reel.views || 0,
            reel.likes || 0,
            reel.comments || 0,
            reel.er || 0
          ]);
        });
      }
    });

    autoFitColumns(summarySheet);
    autoFitColumns(breakdownSheet);
  }

  return await workbook.xlsx.writeBuffer();
}

function generateCsvExport(job) {
  const isReel = job.type === 'reel';
  const origCols = job.originalColumns || [];
  const headers = isReel
    ? ['SR No.', ...origCols.map(c => c.renamedTo || c.name), 'Views', 'Likes', 'Comments', 'Shares', 'Engagement Rate']
    : ['SR No.', ...origCols.map(c => c.renamedTo || c.name), 'Followers', 'Average Views', 'Average ER'];

  let csv = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',') + '\n';

  job.rows.forEach((row, idx) => {
    const origData = origCols.map(c => row.input.original[c.name] ?? '');
    const res = row.result || {};
    const line = isReel
      ? [idx + 1, ...origData, res.views ?? '', res.likes ?? '', res.comments ?? '', res.shares ?? '', res.er ?? '']
      : [idx + 1, ...origData, res.followers ?? '', res.avgViews ?? '', res.avgEr ?? ''];

    csv += line.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
  });

  return csv;
}

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: '1A1C20' }, name: 'Inter', size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FBE9EC' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 24;
}

function styleDataRow(row, state) {
  row.font = { name: 'Inter', size: 10 };
  if (state === 'invalid') {
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FBE7E7' } };
  } else if (state === 'duplicate') {
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FAF0DF' } };
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

module.exports = { generateExcelExport, generateCsvExport };
