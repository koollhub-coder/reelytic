/*
  Finds text that leaves its box. Runs INSIDE the page (page.evaluate), so it
  must stay self-contained: no imports, no outer variables.

  Reports three kinds of problem:
    - text sitting outside the card, table or tile that holds it
    - a card or tile stretched wider than whatever contains it
    - text cut off hard (overflow hidden, no ellipsis), so a reader sees half a word
  A box that clips on purpose with an ellipsis, or scrolls (overflow auto), is fine.
*/
function findOverflow() {
  const bad = [];
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  document.querySelectorAll('.card, .rl-dt, .rl-mc, .rl-stat-strip, .rl-metric-grid > *').forEach((card) => {
    if (!visible(card)) return;
    const box = card.getBoundingClientRect();
    const parent = card.parentElement;
    if (parent && getComputedStyle(parent).overflowX === 'visible') {
      const pr = parent.getBoundingClientRect();
      if (pr.width > 0 && box.right > pr.right + 1) bad.push(`box ${name(card)} spills out of its container`);
    }
    card.querySelectorAll('*').forEach((el) => {
      if (!hasOwnText(el) || !visible(el)) return;
      const r = el.getBoundingClientRect();
      for (let p = el; p && p !== card; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') return;
      }
      if (r.right > box.right + 1 || r.left < box.left - 1) {
        bad.push(`text ${name(el)} "${el.textContent.trim().slice(0, 40)}" is outside ${name(card)}`);
      }
    });
  });

  document.querySelectorAll('body *').forEach((el) => {
    if (!hasOwnText(el) || !visible(el)) return;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') return;
    if (el.scrollWidth <= el.clientWidth + 1) return;
    if (cs.textOverflow === 'ellipsis') return;
    if (el.closest('[aria-hidden="true"], .sr-only')) return;
    bad.push(`cut ${name(el)} "${el.textContent.trim().slice(0, 40)}" is clipped with no ellipsis`);
  });

  // Text that lands off the right edge of the screen, where nobody can scroll to it.
  const vw = window.innerWidth;
  document.querySelectorAll('body *').forEach((el) => {
    if (!hasOwnText(el) || !visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1) return;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return;
    }
    bad.push(`offscreen ${name(el)} "${el.textContent.trim().slice(0, 40)}" runs past the right edge of the screen`);
  });

  // Layout consistency, which overflow checks cannot see.
  // 1. Buttons that share a row must be the same height, and none may wrap its label onto two lines.
  document.querySelectorAll('body *').forEach((parent) => {
    const btns = [...parent.children].map((c) => (c.matches('.btn') ? c : c.querySelector(':scope > .btn'))).filter((b) => b && visible(b));
    if (btns.length < 2) return;
    const rows = new Map();
    btns.forEach((b) => { const r = b.getBoundingClientRect(); const k = Math.round(r.top / 8); rows.set(k, [...(rows.get(k) || []), r]); });
    rows.forEach((rects) => {
      if (rects.length < 2) return;
      const hs = rects.map((r) => Math.round(r.height));
      if (Math.max(...hs) - Math.min(...hs) > 2) bad.push('buttons ' + name(parent) + ' "' + parent.textContent.trim().slice(0, 40) + '" sit in one row at different heights');
    });
  });
  document.querySelectorAll('.btn').forEach((b) => {
    if (!visible(b) || b.closest('[data-allow-wrap]')) return;
    // A button built as a title plus a hint is meant to be two lines.
    if ([...b.children].some((c) => c.textContent.trim() && getComputedStyle(c).display === 'block')) return;
    const tops = new Set();
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      [...range.getClientRects()].forEach((r) => tops.add(Math.round((r.top + r.height / 2) / 10)));
    }
    if (tops.size > 1) bad.push('wrap button "' + b.textContent.trim().slice(0, 40) + '" label breaks onto a second line');
  });

  // 2. A card grid whose last row is only partly filled leaves a hole.
  document.querySelectorAll('body *').forEach((g) => {
    const cs = getComputedStyle(g);
    if (cs.display !== 'grid' || !visible(g)) return;
    const kids = [...g.children].filter(visible);
    if (kids.length < 3 || !kids.every((k) => k.matches('.card, .feature-card, .rl-mc'))) return;
    const cols = cs.gridTemplateColumns.split(' ').length;
    if (cols < 2) return;
    if (kids.length % cols !== 0 && !g.hasAttribute('data-allow-orphan')) bad.push('grid ' + name(g) + ' has ' + kids.length + ' cards in ' + cols + ' columns, so the last row is left with a hole');
  });

  // 3. Native controls must not show the browser's own blue.
  document.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((i) => {
    if (!visible(i)) return;
    const a = getComputedStyle(i).appearance;
    if (a !== 'none') bad.push('control input[' + i.type + '] uses the browser default look, not the app theme');
  });

  return bad;
}

module.exports = { findOverflow };
