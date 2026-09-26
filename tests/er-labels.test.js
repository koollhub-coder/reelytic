const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const { generateCsvExport, generateSharedReportExcel } = require('../server/services/export.service');

/*
  A Reel's ER divides by views; a Profile's average ER divides by followers.
  Both used to be headed "ER (%)" or "Engagement rate", so a client reading
  two exports side by side had no way to tell they were different measures,
  and the shared profile workbook's footer even printed the per-view formula.
  Pure export functions, no server or database needed.
*/

const reelJob = {
  type: 'reel', fileName: 'r.xlsx', createdAt: new Date('2026-09-01'), originalColumns: [],
  rows: [{ i: 1, state: 'done', input: { url: 'https://www.instagram.com/reel/ABC' }, result: { username: 'a', followers: 10, reelLink: 'https://www.instagram.com/reel/ABC', views: 100, likes: 5, comments: 1, er: 6 } }],
};
const profileJob = {
  type: 'profile', fileName: 'p.xlsx', createdAt: new Date('2026-09-01'), originalColumns: [],
  rows: [{ i: 1, state: 'done', input: { url: 'https://www.instagram.com/a' }, result: { username: 'a', followers: 1000, avgViews: 500, avgEr: 2.1, reelsAnalyzed: 6 } }],
};

const headerOf = (csv) => csv.split(/\r?\n/)[0];

describe('the two engagement rates are labelled by what they divide by', () => {
  test('reel CSV says views', () => {
    const head = headerOf(generateCsvExport(reelJob));
    assert.ok(head.includes('ER % (views)'), head);
    assert.ok(!head.includes('ER (%)'), 'old ambiguous label is gone');
  });

  test('profile CSV says followers', () => {
    const head = headerOf(generateCsvExport(profileJob));
    assert.ok(head.includes('Avg ER % (followers)'), head);
    assert.ok(!head.includes('Average ER (%)'), 'old ambiguous label is gone');
  });

  test('shared profile workbook states the per-follower formula, not the per-view one', async () => {
    const buf = await generateSharedReportExcel({ job: profileJob, branding: {} });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const text = [];
    wb.worksheets[0].eachRow((row) => text.push(row.values.filter(Boolean).join(' | ')));
    const all = text.join('\n');
    assert.ok(all.includes('Avg ER % (followers)'), all);
    assert.ok(all.includes('/ Followers'), 'footer must give the follower formula');
    assert.ok(!all.includes('/ Views'), 'footer must not give the per-view formula on a profile report');
  });

  test('the app uses the same wording as the exports', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'utils', 'erLabels.js'), 'utf8');
    assert.ok(src.includes("'ER % (views)'"));
    assert.ok(src.includes("'Avg ER % (followers)'"));
  });
});
