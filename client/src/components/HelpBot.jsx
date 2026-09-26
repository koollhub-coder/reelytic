import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ChatIcon, SendIcon, XIcon, SparkleIcon, ReplayIcon, ArrowUpRightIcon, ArrowRightIcon, ThumbsUpIcon, ThumbsDownIcon } from './Icon';
import { TOPICS, ENTRIES, SUPPORT_EMAIL } from '../content/helpKnowledge';
import { ask, renderAnswer, getEntry, starterEntries } from '../utils/helpMatcher';
import '../styles/helpbot.css';

/*
  The help assistant. A static, always-on guide: it answers from the library
  in content/helpKnowledge.js, understands rephrasings and typos through
  utils/helpMatcher.js, and can take someone to the right page. No outside
  service is involved, so it costs nothing to run, cannot go down, and cannot
  say anything we did not write.

  Open to everyone, signed in or not. Visitors on the marketing pages can ask
  what Reelytic does; customers get answers that know their plan and credits.

  What it shares with us: unanswered questions (so we can write the missing
  answer) and thumbs-down votes. Answered questions record only which answer
  was shown, never the words typed.
*/

const EXAMPLE_PROMPTS = [
  'Ask how credits are charged',
  'Ask why a link failed',
  'Try "take me to History"',
  'Ask about client portals',
  'Ask how engagement is calculated',
  'Ask what your plan includes',
];

const HIDDEN_PREFIXES = ['/admin', '/share/', '/portal/', '/reports/'];
const HIDDEN_EXACT = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email', '/team/accept', '/dev-unlock', '/change-password', '/checkout'];

const MAX_SAVED = 30;

function shouldShow(pathname, user) {
  if (HIDDEN_EXACT.includes(pathname)) return false;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  if (user && user.mustChangePassword) return false;
  return true;
}

// Fire and forget: the assistant must never be slowed or broken by logging.
function report(payload) {
  try {
    fetch('/api/help/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}

// Plans and credit rules are read live (once per page load) so answers never
// drift from what the product really does. Prices are never used.
let livePromise = null;
function loadLive() {
  if (!livePromise) {
    const get = (url) => fetch(url).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    livePromise = Promise.all([get('/api/pricing/plans'), get('/api/help/facts')])
      .then(([plans, facts]) => ({ plans: (plans && plans.plans) || [], facts: facts || null }));
  }
  return livePromise;
}

// Pages a logged-out visitor can actually open. Everything else sits behind sign in.
const PUBLIC_TARGETS = ['/pricing', '/terms', '/privacy'];
const forVisitor = (to) => (to === '/billing' ? '/pricing' : to);

let counter = 0;
const nextId = () => { counter += 1; return `m${Date.now().toString(36)}${counter}`; };

/* Tiny formatter for answer text: paragraphs, "- " bullets and **bold**. */
function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => (
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>
  ));
}

function RichText({ text }) {
  const blocks = [];
  for (const chunk of String(text).split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim());
    let paragraph = [];
    let bullets = [];
    const flushP = () => { if (paragraph.length) { blocks.push({ type: 'p', text: paragraph.join(' ') }); paragraph = []; } };
    const flushB = () => { if (bullets.length) { blocks.push({ type: 'ul', items: bullets }); bullets = []; } };
    for (const line of lines) {
      if (/^\s*-\s+/.test(line)) { flushP(); bullets.push(line.replace(/^\s*-\s+/, '')); } else { flushB(); paragraph.push(line.trim()); }
    }
    flushP();
    flushB();
  }
  return (
    <>
      {blocks.map((b, i) => (b.type === 'p'
        ? <p key={i}><Inline text={b.text} /></p>
        : <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>))}
    </>
  );
}

function BotAvatar() {
  return <span className="rl-help-avatar sm" aria-hidden="true"><SparkleIcon size={14} /></span>;
}

function TypingRow() {
  return (
    <div className="rl-help-row" aria-label="Assistant is typing">
      <BotAvatar />
      <div className="rl-help-typing" role="status"><i /><i /><i /></div>
    </div>
  );
}

export function HelpBot() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [promptIdx, setPromptIdx] = useState(0);
  const [live, setLive] = useState({ plans: [], facts: null });
  const [ping] = useState(() => { try { return !sessionStorage.getItem('rl-help-seen'); } catch (e) { return false; } });

  const stateRef = useRef({ lastEntryId: null, pendingIds: [] });
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const timers = useRef([]);

  const ctx = useMemo(() => ({ user: user || null, features: (user && user.features) || {}, route: pathname, plans: live.plans, facts: live.facts }), [user, pathname, live]);
  const storageKey = `rl-help-chat:v1:${user ? user.username : 'visitor'}`;
  const firstName = user && user.name ? String(user.name).split(' ')[0] : '';

  /* ---- conversation survives a reload, per person, for the session ---- */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        setMessages(Array.isArray(saved.messages) ? saved.messages : []);
        stateRef.current = saved.state || { lastEntryId: null, pendingIds: [] };
        return;
      }
    } catch (e) { /* private mode etc */ }
    setMessages([]);
    stateRef.current = { lastEntryId: null, pendingIds: [] };
  }, [storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ messages: messages.slice(-MAX_SAVED), state: stateRef.current }));
    } catch (e) { /* ignore */ }
  }, [messages, storageKey]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* ---- keep the newest message in view ---- */
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    // The welcome screen reads top to bottom; only a live conversation follows
    // its newest message.
    requestAnimationFrame(() => { el.scrollTop = messages.length || typing ? el.scrollHeight : 0; });
  }, [messages, typing, open]);

  /* ---- rotating example prompt while the box is empty ---- */
  useEffect(() => {
    if (!open || input) return undefined;
    const t = setInterval(() => setPromptIdx((i) => (i + 1) % EXAMPLE_PROMPTS.length), 4200);
    return () => clearInterval(t);
  }, [open, input]);

  useEffect(() => {
    if (open && typeof window !== 'undefined' && window.innerWidth > 560 && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Escape closes the panel from anywhere on the page, not only while focus
  // is inside it (after "take me to History" focus is on the new page). If a
  // real dialog is open on top, Escape belongs to that one instead.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.rl-modal-overlay')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const openPanel = () => {
    setOpen(true);
    loadLive().then(setLive);
    try { sessionStorage.setItem('rl-help-seen', '1'); } catch (e) { /* ignore */ }
  };
  const closePanel = () => {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current && launcherRef.current.focus());
  };

  const push = useCallback((...msgs) => setMessages((prev) => [...prev, ...msgs.map((m) => ({ id: nextId(), ...m }))]), []);

  /* ---- turning a matcher result into messages ---- */
  const answerMessage = useCallback((entry, extra = {}) => ({
    role: 'bot',
    entryId: entry.id,
    text: renderAnswer(entry, ctx),
    actions: (entry.actions || [])
      .map((a) => (user ? a : { ...a, to: forVisitor(a.to) }))
      .filter((a) => user || !a.to.startsWith('/') || PUBLIC_TARGETS.includes(a.to)),
    related: (entry.related || []).slice(0, 3),
    rateable: true,
    rated: null,
    ...extra,
  }), [ctx, user]);

  const respond = useCallback((text, direct) => {
    const result = direct
      ? { kind: 'answer', entries: [direct], tentative: false, alternatives: [] }
      : ask(text, stateRef.current, ctx);
    let replies = [];
    let next = { ...stateRef.current, pendingIds: [] };
    let navigateTo = null;
    let logPayload = null;

    switch (result.kind) {
      case 'smalltalk':
        replies = [{ role: 'bot', text: result.reply, topicChips: ['greet', 'capabilities', 'who'].includes(result.id) }];
        break;
      case 'nav': {
        const t = result.target;
        const dest = user ? t.to : forVisitor(t.to);
        if (!user && !PUBLIC_TARGETS.includes(dest)) {
          replies = [{ role: 'bot', text: `You will need to sign in to open **${t.label}**. Once you are in, just ask me again and I will take you there.`, actions: [{ label: 'Sign in', to: '/login' }, { label: 'Create a free account', to: '/signup' }] }];
        } else {
          replies = [{ role: 'bot', text: `Opening **${t.label}** for you.`, actions: [{ label: `Open ${t.label}`, to: dest }] }];
          navigateTo = dest;
        }
        break;
      }
      case 'answer': {
        replies = result.entries.map((e, i) => {
          const isLast = i === result.entries.length - 1;
          return answerMessage(e, {
            lead: i === 0 && result.tentative ? `I think you are asking: **${e.q}**` : null,
            alternatives: isLast ? (result.alternatives || []).map((a) => a.id) : [],
          });
        });
        next.lastEntryId = result.entries[0].id;
        logPayload = { kind: result.tentative ? 'tentative' : 'answered', entryId: result.entries[0].id };
        if (result.tentative) logPayload.q = text;
        break;
      }
      case 'suggest':
        replies = [{ role: 'bot', text: 'I am not completely sure what you mean. Did you mean one of these?', suggestions: result.suggestions.map((s) => s.id), actions: [{ label: 'Email the team', to: `mailto:${SUPPORT_EMAIL}` }] }];
        next.pendingIds = result.suggestions.map((s) => s.id);
        logPayload = { kind: 'suggest', q: text };
        break;
      case 'more': {
        const e = result.entry;
        replies = [{
          role: 'bot',
          text: 'Happy to go further. Here are related things people ask next:',
          suggestions: (e.related || []).slice(0, 3),
          actions: (e.actions || []).slice(0, 2),
        }];
        break;
      }
      case 'fallback':
      default:
        replies = [{
          role: 'bot',
          text: result.declined
            ? 'No problem. Try asking it another way, or pick a topic below.'
            : 'I do not have a good answer to that yet, and I would rather not guess. Pick a topic below, or email the team and a real person will help.',
          topicChips: true,
          actions: [{ label: 'Email the team', to: `mailto:${SUPPORT_EMAIL}` }],
        }];
        if (!result.declined) logPayload = { kind: 'fallback', q: text };
        break;
    }

    const words = replies.reduce((n, r) => n + String(r.text || '').split(' ').length, 0);
    const delay = Math.min(900, 380 + words * 5);
    setTyping(true);
    const t = setTimeout(() => {
      push(...replies);
      stateRef.current = next;
      setTyping(false);
      if (navigateTo) {
        navigate(navigateTo);
        if (typeof window !== 'undefined' && window.innerWidth <= 560) setOpen(false);
      }
    }, delay);
    timers.current.push(t);
    if (logPayload) report({ ...logPayload, route: pathname });
  }, [ctx, user, answerMessage, push, navigate, pathname]);

  const submit = (raw, direct) => {
    const text = String(raw || '').trim().slice(0, 300);
    if (!text || typing) return;
    push({ role: 'user', text });
    setInput('');
    respond(text, direct);
  };

  const askEntry = (entry) => submit(entry.q, entry);

  const showTopic = (topic) => {
    if (typing) return;
    push({ role: 'user', text: topic.label });
    const ids = ENTRIES.filter((e) => e.topic === topic.id).map((e) => e.id);
    setTyping(true);
    const t = setTimeout(() => {
      push({ role: 'bot', text: `Here is what I can help with under **${topic.label}**:`, listIds: ids });
      setTyping(false);
    }, 350);
    timers.current.push(t);
  };

  const rate = (msg, value) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, rated: value } : m)));
    report({ kind: 'rated', entryId: msg.entryId, helpful: value === 'up', route: pathname });
    if (value === 'down') {
      const t = setTimeout(() => push({
        role: 'bot',
        text: 'Sorry that did not help. Try asking it in different words, or email the team and a real person will sort it out.',
        actions: [{ label: 'Email the team', to: `mailto:${SUPPORT_EMAIL}` }],
      }), 300);
      timers.current.push(t);
    }
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    setTyping(false);
    setMessages([]);
    stateRef.current = { lastEntryId: null, pendingIds: [] };
    setInput('');
    if (inputRef.current) inputRef.current.focus();
  };

  const onAction = (a) => {
    if (a.to.startsWith('mailto:')) return;
    navigate(a.to);
    if (typeof window !== 'undefined' && window.innerWidth <= 560) setOpen(false);
  };


  const lastBot = [...messages].reverse().find((m) => m.role === 'bot');
  const starters = useMemo(() => starterEntries(), []);

  // Not while the workspace is still loading: the bubble floating over the
  // boot screen looks unfinished.
  if (loading || !shouldShow(pathname, user)) return null;

  const renderActions = (list) => (list && list.length ? (
    <div className="rl-help-actions">
      {list.map((a) => (a.to.startsWith('mailto:')
        ? <a key={a.label} className="rl-help-action" href={a.to}>{a.label}<ArrowUpRightIcon size={13} /></a>
        : <button key={a.label} type="button" className="rl-help-action" onClick={() => onAction(a)}>{a.label}<ArrowRightIcon size={13} /></button>))}
    </div>
  ) : null);

  const renderTopicChips = () => (
    <div className="rl-help-chips" role="group" aria-label="Topics">
      {TOPICS.map((t) => <button key={t.id} type="button" className="rl-help-chip" onClick={() => showTopic(t)}>{t.label}</button>)}
    </div>
  );

  const renderQuestionChips = (ids, label) => {
    const items = (ids || []).map(getEntry).filter(Boolean);
    if (!items.length) return null;
    return (
      <div>
        {label && <div className="rl-help-section-label" style={{ marginBottom: 6 }}>{label}</div>}
        <div className="rl-help-chips">
          {items.map((e) => <button key={e.id} type="button" className="rl-help-chip" onClick={() => askEntry(e)}>{e.q}</button>)}
        </div>
      </div>
    );
  };

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className={`rl-help-launcher${ping ? ' rl-help-ping' : ''}`}
          onClick={openPanel}
          aria-label="Open the Reelytic help assistant"
          aria-expanded="false"
          data-help-launcher
        >
          <ChatIcon size={22} strokeWidth={2} />
          <span className="rl-help-launcher-label">Help</span>
        </button>
      )}

      {open && (
        <section className="rl-help-panel" role="dialog" aria-label="Reelytic assistant" data-help-panel>
          <header className="rl-help-head">
            <span className="rl-help-avatar" aria-hidden="true"><SparkleIcon size={19} /></span>
            <div>
              <div className="rl-help-title">Reelytic Assistant</div>
              <div className="rl-help-sub"><span className="rl-help-dot" aria-hidden="true" />Instant answers, any time</div>
            </div>
            <div className="rl-help-head-actions">
              {messages.length > 0 && (
                <button type="button" className="rl-help-iconbtn" onClick={reset} aria-label="Start a new chat" title="New chat"><ReplayIcon size={16} /></button>
              )}
              <button type="button" className="rl-help-iconbtn" onClick={closePanel} aria-label="Close the assistant" title="Close"><XIcon size={18} /></button>
            </div>
          </header>

          <div className="rl-help-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
            {messages.length === 0 && (
              <>
                <div className="rl-help-welcome">
                  <span className="rl-help-avatar" aria-hidden="true"><SparkleIcon size={24} /></span>
                  <h3>{firstName ? `Hi ${firstName}, how can I help?` : 'Hi, how can I help?'}</h3>
                  <p>Ask me how anything in Reelytic works, why something happened, or where to find it. I can also take you to the right page.</p>
                </div>
                <div className="rl-help-starters">
                  <div className="rl-help-section-label">Popular questions</div>
                  <div className="rl-help-list">
                    {starters.map((e) => (
                      <button key={e.id} type="button" onClick={() => askEntry(e)}>{e.q}<ArrowRightIcon size={14} /></button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="rl-help-section-label" style={{ marginBottom: 6 }}>Browse by topic</div>
                  {renderTopicChips()}
                </div>
              </>
            )}

            {messages.map((m) => (m.role === 'user' ? (
              <div key={m.id} className="rl-help-row user"><div className="rl-help-bubble">{m.text}</div></div>
            ) : (
              <div key={m.id} className="rl-help-row">
                <BotAvatar />
                <div className="rl-help-col">
                  {m.lead && <div className="rl-help-lead"><Inline text={m.lead} /></div>}
                  <div className="rl-help-bubble"><RichText text={m.text} /></div>
                  {m.listIds && (
                    <div className="rl-help-list">
                      {m.listIds.map(getEntry).filter(Boolean).map((e) => (
                        <button key={e.id} type="button" onClick={() => askEntry(e)}>{e.q}<ArrowRightIcon size={14} /></button>
                      ))}
                    </div>
                  )}
                  {renderActions(m.actions)}
                  {m === lastBot && m.suggestions && renderQuestionChips(m.suggestions)}
                  {m === lastBot && m.alternatives && m.alternatives.length > 0 && renderQuestionChips(m.alternatives, 'Or did you mean')}
                  {m === lastBot && m.related && m.related.length > 0 && renderQuestionChips(m.related, 'You might also ask')}
                  {m.topicChips && m === lastBot && renderTopicChips()}
                  {m.rateable && (
                    <div className="rl-help-rate">
                      {m.rated ? (
                        <span className="rl-help-thanks">{m.rated === 'up' ? 'Glad that helped.' : 'Thanks for telling us.'}</span>
                      ) : (
                        <>
                          <span>Helpful?</span>
                          <button type="button" onClick={() => rate(m, 'up')} aria-label="Yes, helpful"><ThumbsUpIcon size={14} /></button>
                          <button type="button" onClick={() => rate(m, 'down')} aria-label="No, not helpful"><ThumbsDownIcon size={14} /></button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )))}
            {typing && <TypingRow />}
          </div>

          <div className="rl-help-foot">
            <form className="rl-help-form" onSubmit={(e) => { e.preventDefault(); submit(input); }}>
              <input
                ref={inputRef}
                className="rl-help-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={EXAMPLE_PROMPTS[promptIdx]}
                maxLength={300}
                aria-label="Ask the assistant a question"
                autoComplete="off"
                enterKeyHint="send"
              />
              <button type="submit" className="rl-help-send" disabled={!input.trim() || typing} aria-label="Send"><SendIcon size={17} /></button>
            </form>
            <p className="rl-help-note">
              Answers come from Reelytic&apos;s own help library. Need a person? <a href={`mailto:${SUPPORT_EMAIL}`}>Email us</a>
            </p>
          </div>
        </section>
      )}
    </>
  );
}
