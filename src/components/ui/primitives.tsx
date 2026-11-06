import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly icon: LucideIcon;
  /** Accessible name and tooltip. Required: icon-only controls must be labelled. */
  readonly label: string;
  readonly pressed?: boolean;
  readonly badge?: number;
  readonly size?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, pressed, badge, size = 18, className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`icon-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon size={size} aria-hidden="true" strokeWidth={1.75} />
      {badge !== undefined && badge > 0 && (
        <span className="icon-btn__badge" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
});

export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ label }: { readonly label?: string }) {
  return (
    <span role="status" className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function EmptyState(props: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
      <h3>{props.title}</h3>
      {props.children && <p>{props.children}</p>}
      {props.actions && <div className="empty__actions">{props.actions}</div>}
    </div>
  );
}
