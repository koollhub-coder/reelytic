import React from 'react';
import { reportError } from '../utils/errorReporter';

/*
  Catches a component crash and turns it into something survivable.

  Without this, a throw anywhere in the tree unmounts the whole app and the
  user is left staring at a blank white page with no message, no way back,
  and no record that it happened. That is the single worst failure mode this
  app has, because it looks identical to the site being down and we would
  only ever hear about it if someone bothered to report it.

  Two jobs, in this order: tell the server, then give the user a way out.

  Deliberately NOT a full-page takeover of the whole app. It wraps the routed
  page, so the sidebar and navigation survive a crash on any one screen and
  the user can simply go somewhere else.
*/
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError({
      kind: 'client-crash',
      message: error && error.message,
      stack: error && error.stack,
      // React's component stack survives minification better than the JS
      // stack does, so it is often the only readable clue about where this
      // happened. Worth sending even though it duplicates some of the above.
      extra: { componentStack: info && info.componentStack },
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="card" style={{ maxWidth: '520px', margin: 'var(--s7) auto', padding: 'var(--s6)', textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
          This screen ran into a problem
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
          Nothing you have done has been lost, and your reports are unaffected. We have been told about this
          automatically. Try the page again, or head back to your reports.
        </p>
        <div style={{ display: 'flex', gap: 'var(--s3)', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: '38px', padding: '0 var(--s5)' }}
            /*
              A full reload rather than clearing the error state. Whatever put
              the component into a bad state is usually still in memory, so
              re-rendering the same tree tends to throw again immediately and
              looks like the button is broken.
            */
            onClick={() => window.location.reload()}
          >
            Reload this page
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: '38px', padding: '0 var(--s5)' }}
            onClick={() => { window.location.href = '/reels'; }}
          >
            Back to my reports
          </button>
        </div>
      </div>
    );
  }
}
