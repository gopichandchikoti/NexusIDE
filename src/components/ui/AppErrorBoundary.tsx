import { Component, type ReactNode } from 'react';

interface State {
  readonly failed: boolean;
}

/** Last line of defence: a render crash must not look like data loss. Storage is untouched by a crash. */
export class AppErrorBoundary extends Component<{ readonly children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="notice notice--page" role="alert">
        <h1>NexusIDE hit an unexpected error</h1>
        <p>
          Your files are stored in this browser and were not changed by the error. Reloading usually fixes it. If it
          keeps happening, you can clear this site&apos;s data after exporting a ZIP from a working tab.
        </p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
