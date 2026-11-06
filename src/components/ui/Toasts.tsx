import { AlertTriangle, CheckCircle2, Info, XCircle, X, type LucideIcon } from 'lucide-react';
import { useUiStore, type ToastKind } from '@/store/uiStore';
import { IconButton } from './primitives';

const ICONS: Record<ToastKind, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

/** Each kind has an icon and a word, so meaning never depends on colour alone. */
const WORDS: Record<ToastKind, string> = { info: 'Note', success: 'Done', warning: 'Warning', error: 'Error' };

export function Toasts() {
  const toasts = useUiStore(s => s.toasts);
  const dismiss = useUiStore(s => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => {
        const Icon = ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            className={`toast toast--${toast.kind}`}
            role={toast.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon size={18} aria-hidden="true" />
            <p>
              <strong>{WORDS[toast.kind]}.</strong> {toast.message}
            </p>
            {toast.action && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  toast.action?.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <IconButton icon={X} label="Dismiss notification" size={16} onClick={() => dismiss(toast.id)} />
          </div>
        );
      })}
    </div>
  );
}
