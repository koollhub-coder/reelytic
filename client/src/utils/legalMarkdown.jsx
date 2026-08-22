import React from 'react';

/*
  Deliberately not a general markdown parser -- Terms/Privacy content only
  ever needs headings, paragraphs, and bullet lists. Keeping the format this
  narrow means admin-edited content can be rendered with zero HTML-injection
  risk: nothing in this path ever touches dangerouslySetInnerHTML, so even a
  compromised admin account can't turn the legal pages into a script vector.
*/
export function renderLegalMarkdown(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = [];

  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = []; }
  };
  const flushList = () => {
    if (list.length) { blocks.push({ type: 'ul', items: list }); list = []; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (line.startsWith('## ')) { flushPara(); flushList(); blocks.push({ type: 'h2', text: line.slice(3).trim() }); continue; }
    if (line.startsWith('# ')) { flushPara(); flushList(); blocks.push({ type: 'h1', text: line.slice(2).trim() }); continue; }
    if (line.startsWith('- ')) { flushPara(); list.push(line.slice(2).trim()); continue; }
    para.push(line);
  }
  flushPara();
  flushList();

  return blocks.map((b, i) => {
    if (b.type === 'h1') {
      return <h1 key={i} style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, margin: '0 0 var(--s4) 0' }}>{b.text}</h1>;
    }
    if (b.type === 'h2') {
      return <h2 key={i} style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, margin: 'var(--s6) 0 var(--s3) 0' }}>{b.text}</h2>;
    }
    if (b.type === 'ul') {
      return (
        <ul key={i} style={{ margin: '0 0 var(--s4) 0', paddingLeft: '1.25em', color: 'var(--text-2)', lineHeight: 1.7 }}>
          {b.items.map((it, j) => <li key={j} style={{ marginBottom: '4px' }}>{it}</li>)}
        </ul>
      );
    }
    return <p key={i} style={{ margin: '0 0 var(--s4) 0', color: 'var(--text-2)', lineHeight: 1.7 }}>{b.text}</p>;
  });
}
