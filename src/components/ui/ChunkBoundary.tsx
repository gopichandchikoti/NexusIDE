import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  /** What failed to load, e.g. "The editor" */
  readonly what: string;
  readonly children: ReactNode;
  /** Create a fresh lazy component so React does not reuse the cached rejected import */
  readonly onRetry: () => void;
}

/** Lazy chunks can fail (offline on first use, deploy in between). Say so, keep the rest of the app alive. */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice" role="alert">
        <AlertTriangle size={24} aria-hidden="true" />
        <h2>{this.props.what} could not be loaded</h2>
        <p>
          NexusIDE downloads this part on first use. If you are offline, reconnect and try again. Your files are safe in
          this browser.
        </p>
        <div className="notice__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onRetry();
            }}
          >
            Try again
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
