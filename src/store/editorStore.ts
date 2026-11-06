import { create } from 'zustand';
import { readPref, writePref } from '@/services/prefsStorage';

export interface CursorInfo {
  readonly line: number;
  readonly column: number;
}

export interface EditorStore {
  /** Open files in tab order (file ids) */
  readonly tabs: readonly string[];
  readonly active: string | null;
  readonly cursor: CursorInfo;
  /** One-shot request (from Search / Problems) to scroll the editor to a position once it is ready */
  readonly reveal: { readonly fileId: string; readonly line: number; readonly column: number } | null;

  requestReveal(fileId: string, line: number, column: number): void;
  clearReveal(): void;
  openFile(id: string): void;
  closeTab(id: string): void;
  closeOthers(id: string): void;
  closeAll(): void;
  setActive(id: string): void;
  setCursor(cursor: CursorInfo): void;
  /** Drop tabs for files that no longer exist */
  prune(existing: ReadonlySet<string>): void;
}

const SESSION_KEY = 'nexuside.session.v1';

function neighbour(tabs: readonly string[], closing: string): string | null {
  const index = tabs.indexOf(closing);
  const remaining = tabs.filter(t => t !== closing);
  return remaining[Math.min(index, remaining.length - 1)] ?? null;
}

export function loadSession(): { tabs: string[]; active: string | null } {
  const raw = readPref(SESSION_KEY);
  if (typeof raw !== 'object' || raw === null) return { tabs: [], active: null };
  const o = raw as Record<string, unknown>;
  const tabs = Array.isArray(o.tabs) ? o.tabs.filter((t): t is string => typeof t === 'string').slice(0, 30) : [];
  return { tabs, active: typeof o.active === 'string' && tabs.includes(o.active) ? o.active : (tabs[0] ?? null) };
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabs: [],
  active: null,
  cursor: { line: 1, column: 1 },
  reveal: null,

  requestReveal(fileId, line, column) {
    get().openFile(fileId);
    set({ reveal: { fileId, line, column } });
  },
  clearReveal: () => set({ reveal: null }),

  openFile(id) {
    const { tabs } = get();
    set({ tabs: tabs.includes(id) ? tabs : [...tabs, id], active: id });
  },

  closeTab(id) {
    const { tabs, active } = get();
    if (!tabs.includes(id)) return;
    set({ tabs: tabs.filter(t => t !== id), active: active === id ? neighbour(tabs, id) : active });
  },

  closeOthers: id => set({ tabs: get().tabs.includes(id) ? [id] : [], active: id }),
  closeAll: () => set({ tabs: [], active: null }),
  setActive: id => set(s => (s.tabs.includes(id) ? { active: id } : s)),
  setCursor: cursor => set({ cursor }),

  prune(existing) {
    const { tabs, active } = get();
    const kept = tabs.filter(t => existing.has(t));
    if (kept.length === tabs.length) return;
    set({ tabs: kept, active: active !== null && kept.includes(active) ? active : (kept[0] ?? null) });
  },
}));

useEditorStore.subscribe((state, prev) => {
  if (state.tabs !== prev.tabs || state.active !== prev.active) {
    writePref(SESSION_KEY, { tabs: state.tabs, active: state.active });
  }
});
