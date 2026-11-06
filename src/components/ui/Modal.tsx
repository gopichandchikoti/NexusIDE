import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './primitives';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: number;
  /** Selector of the element to focus first; defaults to the first focusable control */
  readonly initialFocus?: string;
}

/** Accessible dialog: labelled, focus is trapped while open, Escape closes, focus returns to the opener. */
export function Modal({ open, title, onClose, children, footer, width = 560, initialFocus }: ModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const target =
      (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ??
      root?.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? root)?.focus();
    return () => opener?.focus?.();
  }, [open, initialFocus]);

  // Tab handling alone is not a trap: code elsewhere (the editor finishing its lazy load, for example) can call
  // focus() on the page behind the dialog. Pull such focus back, but let it move into another modal on top.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent): void => {
      const root = dialog.current;
      const target = event.target;
      if (!root || !(target instanceof Element) || root.contains(target)) return;
      if (target.closest('[role="dialog"][aria-modal="true"]')) return;
      (root.querySelector<HTMLElement>(FOCUSABLE) ?? root).focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth: width }}
        onKeyDown={onKeyDown}
      >
        <header className="dialog__head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon={X} label="Close dialog" onClick={onClose} />
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}
