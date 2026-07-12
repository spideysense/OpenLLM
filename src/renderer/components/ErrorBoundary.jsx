import React from 'react';

// Catches any render error anywhere in the tree so the app shows a recoverable
// screen instead of a blank white window. Without this, one bad render (e.g. an
// object rendered as a child) unmounts everything and the user sees nothing.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[Aspen] render crash:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, textAlign: 'center', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', background: 'var(--sky-top,#FAFAF7)' }}>
          <div style={{ fontSize: 40 }}>🌿</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-dark,#1D1D1F)' }}>Aspen hit a snag</div>
          <div style={{ fontSize: 13, color: 'var(--text-light,#8A8A8E)', maxWidth: 420, lineHeight: 1.5 }}>
            Something went wrong while drawing this screen. Your data is safe and on your machine. Reloading usually fixes it.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 4, border: 'none', background: 'var(--gd,#5B8C6E)', color: '#fff', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Reload Aspen
          </button>
          <details style={{ marginTop: 8, fontSize: 11, color: 'var(--text-light,#8A8A8E)', maxWidth: 480 }}>
            <summary style={{ cursor: 'pointer' }}>Technical details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left', marginTop: 8 }}>{String(this.state.error?.message || this.state.error)}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
