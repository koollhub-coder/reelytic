const ExcelJS = require('exceljs');
const { normalizeUrl } = require('../utils/urlNormalize');

async function parseSpreadsheetBuffer(buffer, filename, type = 'reel') {
  const ext = filename.split('.').pop().toLowerCase();
  let rawRows = [];
  let originalColumns = [];

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('Uploaded Excel file is empty');

    let headers = [];
    worksheet.eachRow((row, rowNumber) => {
      const values = row.values.slice(1);
      if (rowNumber === 1) {
        headers = values.map(v => String(v || '').trim());
        originalColumns = headers.map(h => ({ name: h, renamedTo: h }));
      } else {
        const rowObj = {};
        headers.forEach((h, idx) => {
          rowObj[h] = values[idx] !== undefined ? values[idx] : '';
        });
        rawRows.push(rowObj);
      }
    });
  } else if (ext === 'csv' || ext === 'txt') {
    const text = buffer.toString('utf8');

    // Check if pasted text contains glued URLs without newlines (e.g. .../reel/ABC?igsh=...https://www.instagram.com/reel/XYZ...)
    const splitRegex = /[\r\n,\s]+|(?=https?:\/\/)/;
    const tokens = text.split(splitRegex).map(l => l.trim()).filter(Boolean);

    if (ext === 'csv' && !text.includes('http')) {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      originalColumns = headers.map(h => ({ name: h, renamedTo: h }));
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        const rowObj = {};
        headers.forEach((h, idx) => {
          rowObj[h] = vals[idx] !== undefined ? vals[idx] : '';
        });
        rawRows.push(rowObj);
      }
    } else {
      // Treat tokens or lines as URLs
      originalColumns = [{ name: 'URL', renamedTo: 'URL' }];
      for (const token of tokens) {
        // If token contains multiple https://, split further
        const subTokens = token.split(/(?=https?:\/\/)/).map(s => s.trim()).filter(Boolean);
        for (const st of subTokens) {
          rawRows.push({ URL: st });
        }
      }
    }
  } else {
    throw new Error(`Unsupported file extension .${ext}. Please upload .xlsx, .xls, .csv or .txt`);
  }

  if (rawRows.length === 0) {
    throw new Error('No data rows found in the uploaded file');
  }

  const sampleHeaders = originalColumns.map(c => c.name);
  let urlCol = sampleHeaders.find(h => {
    const l = h.toLowerCase();
    if (type === 'reel') {
      return l === 'url' || l === 'link' || l.includes('reel') || l.includes('post') || l.includes('instagram link');
    } else {
      return l === 'url' || l === 'profile' || l === 'handle' || l.includes('instagram profile link') || l.includes('creator');
    }
  });

  if (!urlCol) {
    urlCol = sampleHeaders.find(h => {
      const l = h.toLowerCase();
      return l.includes('url') || l.includes('link') || l.includes('profile') || l.includes('reel');
    });
  }

  if (!urlCol && sampleHeaders.length > 0) {
    urlCol = sampleHeaders[0];
  }

  if (!urlCol) {
    throw new Error(`Could not find a URL or Link column. Accepted column names: URL, Link, Reel Link, Instagram Profile Link.`);
  }

  const seenUrls = new Set();
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  const rows = rawRows.map((orig, index) => {
    const rawVal = String(orig[urlCol] || '').trim();
    const norm = normalizeUrl(rawVal, type);

    let state = 'pending';
    let error = null;

    if (!norm.valid) {
      state = 'invalid';
      error = norm.reason;
      invalidCount++;
    } else if (seenUrls.has(norm.normalized)) {
      state = 'duplicate';
      error = `Duplicate of another row`;
      duplicateCount++;
    } else {
      seenUrls.add(norm.normalized);
      validCount++;
    }

    return {
      i: index + 1,
      input: {
        url: norm.valid ? norm.normalized : rawVal,
        original: orig
      },
      state,
      error,
      fromCache: false
    };
  });

  return {
    originalColumns,
    rows,
    counts: {
      total: rows.length,
      processed: 0,
      failed: invalidCount + duplicateCount,
      success: 0,
      skipped: 0,
      valid: validCount,
      invalid: invalidCount,
      duplicates: duplicateCount
    },
    urlColumn: urlCol
  };
}

module.exports = { parseSpreadsheetBuffer };
