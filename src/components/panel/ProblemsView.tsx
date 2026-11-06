import { AlertCircle, AlertTriangle, CheckCircle2, Info, Lightbulb, type LucideIcon } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useProblemsStore, type Severity } from '@/store/problemsStore';
import { EmptyState } from '../ui/primitives';

const ICON: Record<Severity, LucideIcon> = { error: AlertCircle, warning: AlertTriangle, info: Info, hint: Lightbulb };

export function ProblemsView() {
  const items = useProblemsStore(s => s.items);
  if (items.length === 0) {
    return (
      <EmptyState icon={CheckCircle2} title="No problems found">
        The editor checks JavaScript, TypeScript, JSON, CSS and HTML as you type.
      </EmptyState>
    );
  }
  return (
    <ul className="problems" aria-label="Problems">
      {items.map(p => {
        const Icon = ICON[p.severity];
        return (
          <li key={p.key}>
            <button
              type="button"
              className={`problem problem--${p.severity}`}
              onClick={() => useEditorStore.getState().requestReveal(p.fileId, p.line, p.column)}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="problem__sev">{p.severity}</span>
              <span className="problem__msg">{p.message}</span>
              <span className="problem__loc">
                {p.path}:{p.line}:{p.column}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
