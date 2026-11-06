import { create } from 'zustand';
import type { AppError, Result } from '@/domain/errors';
import { fail, ok } from '@/domain/errors';
import {
  createNode,
  deleteNode,
  renameNode,
  updateContent,
  type FsNode,
  type FsState,
  type NewNodeInput,
} from '@/domain/fs';
import { applyChange, describeChange, invert, pushHistory, type FsChange } from '@/domain/history';

export type WorkspaceStatus = 'booting' | 'ready';

export interface WorkspaceStore {
  readonly fs: FsState;
  /** Bumps only when the tree shape changes (not on text edits), so the file tree skips keystroke renders. */
  readonly structure: number;
  readonly status: WorkspaceStatus;
  /** Files whose in-memory text differs from what is committed to IndexedDB */
  readonly dirty: ReadonlySet<string>;
  readonly lastSavedAt: number | null;
  readonly saveError: AppError | null;
  /** True when IndexedDB is unusable: the session works but nothing is persisted. */
  readonly ephemeral: boolean;
  readonly past: readonly FsChange[];
  readonly future: readonly FsChange[];

  hydrate(fs: FsState, ephemeral?: boolean): void;
  create(input: NewNodeInput): Result<FsNode>;
  rename(id: string, name: string): Result<void>;
  remove(id: string): Result<readonly FsNode[]>;
  setContent(id: string, content: string): Result<void>;
  replaceAll(fs: FsState): void;
  undo(): Result<string>;
  redo(): Result<string>;
  markSaved(at: number): void;
  setSaveError(error: AppError | null): void;
}

const noDirty: ReadonlySet<string> = new Set();

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => {
  const recordChange = (fs: FsState, change: FsChange): void =>
    set(s => ({ fs, structure: s.structure + 1, past: pushHistory(s.past, change), future: [] }));

  return {
    fs: {},
    structure: 0,
    status: 'booting',
    dirty: noDirty,
    lastSavedAt: null,
    saveError: null,
    ephemeral: false,
    past: [],
    future: [],

    hydrate: (fs, ephemeral = false) =>
      set(s => ({ fs, structure: s.structure + 1, status: 'ready', dirty: noDirty, past: [], future: [], ephemeral })),

    create(input) {
      const result = createNode(get().fs, input);
      if (!result.ok) return result;
      recordChange(result.value.state, { kind: 'create', nodes: [result.value.node] });
      return ok(result.value.node);
    },

    rename(id, name) {
      const before = get().fs[id];
      const result = renameNode(get().fs, id, name);
      if (!result.ok) return result;
      const after = result.value[id];
      if (before && after && before.name !== after.name) {
        recordChange(result.value, { kind: 'rename', id, from: before.name, to: after.name });
      }
      return ok(undefined);
    },

    remove(id) {
      const result = deleteNode(get().fs, id);
      if (!result.ok) return result;
      const dirty = new Set(get().dirty);
      result.value.removed.forEach(n => dirty.delete(n.id));
      recordChange(result.value.state, { kind: 'delete', nodes: result.value.removed });
      set({ dirty });
      return ok(result.value.removed);
    },

    setContent(id, content) {
      const result = updateContent(get().fs, id, content);
      if (!result.ok) return result;
      if (result.value === get().fs) return ok(undefined);
      set(s => ({ fs: result.value, dirty: s.dirty.has(id) ? s.dirty : new Set(s.dirty).add(id) }));
      return ok(undefined);
    },

    replaceAll: fs => set(s => ({ fs, structure: s.structure + 1, dirty: noDirty, past: [], future: [] })),

    undo() {
      const change = get().past[get().past.length - 1];
      if (!change) return fail('NOT_FOUND', 'Nothing to undo.');
      const result = applyChange(get().fs, invert(change));
      if (!result.ok) return result;
      set(s => ({
        fs: result.value,
        structure: s.structure + 1,
        past: s.past.slice(0, -1),
        future: pushHistory(s.future, change),
      }));
      return ok(describeChange(invert(change)));
    },

    redo() {
      const change = get().future[get().future.length - 1];
      if (!change) return fail('NOT_FOUND', 'Nothing to redo.');
      const result = applyChange(get().fs, change);
      if (!result.ok) return result;
      set(s => ({
        fs: result.value,
        structure: s.structure + 1,
        future: s.future.slice(0, -1),
        past: pushHistory(s.past, change),
      }));
      return ok(describeChange(change));
    },

    markSaved: at => set({ dirty: noDirty, lastSavedAt: at, saveError: null }),
    setSaveError: error => set({ saveError: error }),
  };
});
