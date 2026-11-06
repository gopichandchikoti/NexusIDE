import { create } from 'zustand';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Problem {
  readonly key: string;
  readonly fileId: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly severity: Severity;
  readonly message: string;
  readonly source?: string;
}

export interface ProblemsStore {
  readonly items: readonly Problem[];
  set(items: readonly Problem[]): void;
}

export const MAX_PROBLEMS = 500;

export const useProblemsStore = create<ProblemsStore>()(set => ({
  items: [],
  set: items => set({ items: items.slice(0, MAX_PROBLEMS) }),
}));

export function countBySeverity(items: readonly Problem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const p of items) counts[p.severity] += 1;
  return counts;
}
