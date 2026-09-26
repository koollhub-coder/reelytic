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

  return bad;
}

module.exports = { findOverflow };
