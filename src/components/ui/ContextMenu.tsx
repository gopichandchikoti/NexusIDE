import { useEffect, useRef, type KeyboardEvent } from 'react';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly danger?: boolean;
  readonly run: () => void;
}

interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
  readonly label: string;
}

/** Keyboard-operable menu (Up/Down/Home/End/Enter/Escape). Opened by right-click, the Menu key or Shift+F10. */
export function ContextMenu({ x, y, items, onClose, label }: ContextMenuProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent): void => {
    const entries = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => {
      event.preventDefault();
      entries[(to + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
    }
  };

  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - items.length * 40 - 16);
  return (
    <div ref={root} className="menu" role="menu" aria-label={label} style={{ left, top }} onKeyDown={onKeyDown}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
