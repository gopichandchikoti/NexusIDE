import { History, TriangleAlert } from 'lucide-react';
import { useRecoveryStore } from '@/store/recoveryStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

export function Banners() {
  const drafts = useRecoveryStore(s => s.drafts);
  const ephemeral = useWorkspaceStore(s => s.ephemeral);
  const newest = drafts.reduce((max, d) => Math.max(max, d.savedAt), 0);
  return (
    <>
      {drafts.length > 0 && (
        <div className="banner banner--recover" role="alert">
          <History size={18} aria-hidden="true" />
          <p>
            <strong>Recovered unsaved edits</strong> to {drafts.length} {drafts.length === 1 ? 'file' : 'files'} from
            your last session ({new Date(newest).toLocaleString([], { hour12: false })}).
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() =>
              void useRecoveryStore
                .getState()
                .restore()
                .then(n =>
                  useUiStore.getState().toast('success', `Restored edits to ${n} ${n === 1 ? 'file' : 'files'}.`)
                )
            }
          >
            Restore
          </button>
          <button type="button" className="btn" onClick={() => void useRecoveryStore.getState().discard()}>
            Discard
          </button>
        </div>
      )}
      {ephemeral && (
        <div className="banner banner--warn" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          <p>
            <strong>Browser storage is unavailable</strong> (private window or blocked site data). You can edit and run,
            but nothing is saved. Use Export ZIP to keep your work.
          </p>
        </div>
      )}
    </>
  );
}
