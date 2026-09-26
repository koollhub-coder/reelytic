const session = require('express-session');

/*
  Wraps a session store so that requests arriving at the same moment for the
  same session share ONE store lookup instead of each making their own.

  A page opens with three or four API calls at once, all carrying the same
  cookie, and each used to fetch the same session document from the database.
  Only lookups that are in flight together are shared; nothing is cached once
  a lookup returns, so a later request always reads the store fresh (logout,
  revocation and every write behave exactly as before). Each caller gets its
  own copy of the session data, so one request can never see another's edits.
*/
class CoalescingStore extends session.Store {
  constructor(inner) {
    super();
    this.inner = inner;
    this.pending = new Map();
  }

  get(sid, cb) {
    const waiting = this.pending.get(sid);
    if (waiting) { waiting.push(cb); return; }
    this.pending.set(sid, [cb]);
    this.inner.get(sid, (err, data) => {
      const callbacks = this.pending.get(sid) || [];
      this.pending.delete(sid);
      callbacks.forEach((fn, i) => {
        // the first caller may keep the original object; every other gets a copy
        fn(err, data && i > 0 ? structuredClone(data) : data);
      });
    });
  }

  set(sid, sess, cb) { this.inner.set(sid, sess, cb); }
  destroy(sid, cb) { this.inner.destroy(sid, cb); }
  touch(sid, sess, cb) { if (this.inner.touch) this.inner.touch(sid, sess, cb); else cb(); }
  all(cb) { if (this.inner.all) this.inner.all(cb); else cb(null, []); }
  length(cb) { if (this.inner.length) this.inner.length(cb); else cb(null, 0); }
  clear(cb) { if (this.inner.clear) this.inner.clear(cb); else cb(); }
}

module.exports = { CoalescingStore };
