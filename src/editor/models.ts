import type * as Monaco from 'monaco-editor';
import { pathOf, type FsNode, type FsState } from '@/domain/fs';
import { languageForPath } from '@/domain/languages';
import { LIMITS } from '@/domain/limits';
import { useProblemsStore, type Problem, type Severity } from '@/store/problemsStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

const EAGER_BUDGET_BYTES = 3_000_000;
const PROBLEM_DEBOUNCE_MS = 150;

interface Entry {
  readonly model: Monaco.editor.ITextModel;
  readonly path: string;
  readonly subscription: Monaco.IDisposable;
  readonly bytes: number;
}

/**
 * Owns one Monaco text model per workspace file, so the TypeScript service can resolve imports across files
 * and Problems covers the whole project. The workspace store is the source of truth for saved text;
 * the model is the live editing buffer (with its own undo stack) and mirrors every change into the store.
 */
export class ModelRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly byUri = new Map<string, string>();
  private lastFs: FsState = {};
  private lastStructure = -1;
  private ignoreEcho = false;
  private eagerBytes = 0;
  private problemTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly monaco: typeof Monaco) {}

  start(): () => void {
    const store = useWorkspaceStore;
    this.sync(store.getState().fs, store.getState().structure);
    const unsubscribe = store.subscribe((state, prev) => {
      if (state.fs !== prev.fs) this.sync(state.fs, state.structure);
    });
    const markers = this.monaco.editor.onDidChangeMarkers(() => this.scheduleProblems());
    this.scheduleProblems();
    return () => {
      unsubscribe();
      markers.dispose();
      if (this.problemTimer) clearTimeout(this.problemTimer);
      [...this.entries.keys()].forEach(id => this.dispose(id));
      useProblemsStore.getState().set([]);
    };
  }

  /** The live model for a file; created on demand for files too large to load eagerly. */
  get(fileId: string): Monaco.editor.ITextModel | null {
    const existing = this.entries.get(fileId)?.model;
    if (existing) return existing;
    const { fs } = useWorkspaceStore.getState();
    const node = fs[fileId];
    return node?.kind === 'file' ? (this.create(node, pathOf(fs, fileId))?.model ?? null) : null;
  }

  private sync(fs: FsState, structure: number): void {
    const prev = this.lastFs;
    const structural = structure !== this.lastStructure;
    this.lastFs = fs;
    this.lastStructure = structure;
    for (const id of [...this.entries.keys()]) {
      const node = fs[id];
      if (node?.kind !== 'file') this.dispose(id);
      else if (structural && this.entries.get(id)?.path !== pathOf(fs, id)) this.recreate(node, fs);
      else if (node !== prev[id]) this.applyExternal(id, node.content);
    }
    if (structural) this.createMissing(fs);
  }

  private createMissing(fs: FsState): void {
    for (const node of Object.values(fs)) {
      if (node.kind !== 'file' || this.entries.has(node.id)) continue;
      const bytes = node.content.length;
      if (bytes > LIMITS.largeFileBytes || this.eagerBytes + bytes > EAGER_BUDGET_BYTES) continue;
      this.create(node, pathOf(fs, node.id));
    }
  }

  private recreate(node: FsNode, fs: FsState): void {
    const live = this.entries.get(node.id)?.model.getValue() ?? node.content;
    this.dispose(node.id);
    this.create({ ...node, content: live }, pathOf(fs, node.id));
  }

  private create(node: FsNode, path: string): Entry | null {
    const uri = this.monaco.Uri.from({ scheme: 'file', path: `/${path}` });
    this.monaco.editor.getModel(uri)?.dispose();
    const language = node.content.length > LIMITS.largeFileBytes ? 'plaintext' : languageForPath(path).id;
    const model = this.monaco.editor.createModel(node.content, language, uri);
    const subscription = model.onDidChangeContent(() => this.fromEditor(node.id, model));
    const entry: Entry = { model, path, subscription, bytes: node.content.length };
    this.entries.set(node.id, entry);
    this.byUri.set(uri.toString(), node.id);
    this.eagerBytes += entry.bytes;
    return entry;
  }

  private dispose(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.byUri.delete(entry.model.uri.toString());
    entry.subscription.dispose();
    entry.model.dispose();
    this.eagerBytes -= entry.bytes;
    this.entries.delete(id);
  }

  private applyExternal(id: string, content: string): void {
    const model = this.entries.get(id)?.model;
    if (!model || model.getValue() === content) return;
    this.ignoreEcho = true;
    try {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
    } finally {
      this.ignoreEcho = false;
    }
  }

  private fromEditor(id: string, model: Monaco.editor.ITextModel): void {
    if (this.ignoreEcho) return;
    const result = useWorkspaceStore.getState().setContent(id, model.getValue());
    if (result.ok) return;
    useUiStore.getState().toast('warning', `${result.error.message} The last edit was reverted.`);
    // Put the buffer back to what the store holds (after the current change event has finished dispatching).
    queueMicrotask(() => this.applyExternal(id, useWorkspaceStore.getState().fs[id]?.content ?? ''));
  }

  private scheduleProblems(): void {
    if (this.problemTimer) clearTimeout(this.problemTimer);
    this.problemTimer = setTimeout(() => this.collectProblems(), PROBLEM_DEBOUNCE_MS);
  }

  private collectProblems(): void {
    const severities: Record<number, Severity> = { 8: 'error', 4: 'warning', 2: 'info', 1: 'hint' };
    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 };
    const problems: Problem[] = [];
    for (const marker of this.monaco.editor.getModelMarkers({})) {
      const fileId = this.byUri.get(marker.resource.toString());
      if (!fileId) continue;
      const severity = severities[marker.severity] ?? 'info';
      problems.push({
        key: `${fileId}:${marker.startLineNumber}:${marker.startColumn}:${marker.message}`,
        fileId,
        path: this.entries.get(fileId)?.path ?? marker.resource.path,
        line: marker.startLineNumber,
        column: marker.startColumn,
        severity,
        message: marker.message,
        source: marker.source,
      });
    }
    problems.sort((a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path) || a.line - b.line);
    useProblemsStore.getState().set(problems);
  }
}
