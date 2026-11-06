import type * as Monaco from 'monaco-editor';
import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/limits';
import { fromEntries, type FsState } from '@/domain/fs';
import { useProblemsStore } from '@/store/problemsStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { ModelRegistry } from './models';
import { EDITOR_THEMES } from './themes';

class FakeModel {
  private listeners: Array<() => void> = [];
  disposed = false;
  constructor(
    public value: string,
    public language: string,
    public uri: { toString(): string; path: string }
  ) {}
  getValue = () => this.value;
  getFullModelRange = () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
  pushEditOperations = (_before: unknown, ops: Array<{ text: string }>) => {
    this.value = ops[0]?.text ?? '';
    this.listeners.forEach(l => l());
  };
  onDidChangeContent = (cb: () => void) => {
    this.listeners.push(cb);
    return { dispose: () => (this.listeners = this.listeners.filter(l => l !== cb)) };
  };
  /** What typing in the editor does. */
  type(text: string): void {
    this.value = text;
    this.listeners.forEach(l => l());
  }
  dispose = () => {
    this.disposed = true;
  };
}

interface Marker {
  resource: { toString(): string; path: string };
  severity: number;
  startLineNumber: number;
  startColumn: number;
  message: string;
  source?: string;
}

function makeMonaco() {
  const models = new Map<string, FakeModel>();
  const markerListeners: Array<() => void> = [];
  let markers: Marker[] = [];
  const monaco = {
    Uri: {
      from: ({ scheme, path }: { scheme: string; path: string }) => ({ toString: () => `${scheme}://${path}`, path }),
    },
    editor: {
      createModel: (value: string, language: string, uri: { toString(): string; path: string }) => {
        const model = new FakeModel(value, language, uri);
        models.set(uri.toString(), model);
        return model;
      },
      getModel: (uri: { toString(): string }) => models.get(uri.toString()) ?? null,
      onDidChangeMarkers: (cb: () => void) => {
        markerListeners.push(cb);
        return { dispose: () => undefined };
      },
      getModelMarkers: () => markers,
    },
  };
  return {
    monaco: monaco as unknown as typeof Monaco,
    models,
    setMarkers(next: Marker[]) {
      markers = next;
      markerListeners.forEach(l => l());
    },
  };
}

function seed(files: Record<string, string>): FsState {
  const r = fromEntries(Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const idOf = (name: string): string =>
  Object.values(useWorkspaceStore.getState().fs).find(n => n.name === name)?.id ?? '';
const contentOf = (name: string): string | undefined =>
  Object.values(useWorkspaceStore.getState().fs).find(n => n.name === name)?.content;

beforeEach(() => {
  useWorkspaceStore.setState({ fs: {}, structure: 0, status: 'ready', dirty: new Set(), past: [], future: [] });
  useProblemsStore.setState({ items: [] });
  useUiStore.setState({ toasts: [] });
});

describe('ModelRegistry', () => {
  it('creates one model per file with the right language and path-based URI', () => {
    useWorkspaceStore.getState().hydrate(seed({ 'src/App.tsx': 'a', 'style.css': 'b' }));
    const { monaco, models } = makeMonaco();
    new ModelRegistry(monaco).start();
    expect([...models.keys()].sort()).toEqual(['file:///src/App.tsx', 'file:///style.css']);
    expect(models.get('file:///src/App.tsx')?.language).toBe('typescript');
    expect(models.get('file:///style.css')?.language).toBe('css');
  });

  it('mirrors typing into the workspace store', () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': 'old' }));
    const { monaco, models } = makeMonaco();
    new ModelRegistry(monaco).start();
    models.get('file:///a.ts')?.type('typed in the editor');
    expect(contentOf('a.ts')).toBe('typed in the editor');
    expect(useWorkspaceStore.getState().dirty.has(idOf('a.ts'))).toBe(true);
  });

  it('applies store changes (restore, undo) to the live model without echoing them back', () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': 'one' }));
    const { monaco, models } = makeMonaco();
    new ModelRegistry(monaco).start();
    useWorkspaceStore.getState().setContent(idOf('a.ts'), 'from the store');
    expect(models.get('file:///a.ts')?.value).toBe('from the store');
    expect(useWorkspaceStore.getState().past).toHaveLength(0);
  });

  it('reverts an edit that would exceed the file limit and tells the user', async () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': 'small' }));
    const { monaco, models } = makeMonaco();
    new ModelRegistry(monaco).start();
    models.get('file:///a.ts')?.type('x'.repeat(LIMITS.maxFileBytes + 1));
    expect(contentOf('a.ts')).toBe('small');
    await Promise.resolve();
    expect(models.get('file:///a.ts')?.value).toBe('small');
    expect(useUiStore.getState().toasts.at(-1)?.message).toContain('reverted');
  });

  it('recreates the model on rename (new URI and language) while keeping unsaved text, and disposes on delete', () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.js': 'js code' }));
    const { monaco, models } = makeMonaco();
    new ModelRegistry(monaco).start();
    const first = models.get('file:///a.js') as FakeModel;
    first.type('edited but unsaved');
    useWorkspaceStore.getState().rename(idOf('a.js'), 'a.ts');
    expect(first.disposed).toBe(true);
    const renamed = models.get('file:///a.ts');
    expect(renamed).toMatchObject({ language: 'typescript', value: 'edited but unsaved' });
    useWorkspaceStore.getState().remove(idOf('a.ts'));
    expect(renamed?.disposed).toBe(true);
  });

  it('creates models for files added later, and lazily for very large files as plaintext', () => {
    useWorkspaceStore.getState().hydrate({});
    const { monaco, models } = makeMonaco();
    const registry = new ModelRegistry(monaco);
    registry.start();
    useWorkspaceStore.getState().create({ parentId: null, name: 'new.ts', kind: 'file', content: 'x' });
    expect(models.has('file:///new.ts')).toBe(true);
    const big = useWorkspaceStore.getState().create({
      parentId: null,
      name: 'big.ts',
      kind: 'file',
      content: 'y'.repeat(LIMITS.largeFileBytes + 10),
    });
    expect(models.has('file:///big.ts')).toBe(false);
    const model = registry.get(big.ok ? big.value.id : '') as unknown as FakeModel;
    expect(model.language).toBe('plaintext');
    expect(registry.get('missing')).toBeNull();
  });

  it('collects Monaco markers into Problems, sorted by severity, mapped to file ids', async () => {
    useWorkspaceStore.getState().hydrate(seed({ 'a.ts': '', 'b.ts': '' }));
    const { monaco, models, setMarkers } = makeMonaco();
    const stop = new ModelRegistry(monaco).start();
    const uriOf = (name: string) => (models.get(`file:///${name}`) as FakeModel).uri;
    setMarkers([
      { resource: uriOf('b.ts'), severity: 4, startLineNumber: 2, startColumn: 3, message: 'warn' },
      { resource: uriOf('a.ts'), severity: 8, startLineNumber: 1, startColumn: 1, message: 'err', source: 'ts' },
      {
        resource: { toString: () => 'inmemory://other', path: '/other' },
        severity: 8,
        startLineNumber: 1,
        startColumn: 1,
        message: 'ignored',
      },
    ]);
    await new Promise(r => setTimeout(r, 200));
    const items = useProblemsStore.getState().items;
    expect(items.map(i => `${i.severity}:${i.path}:${i.line}`)).toEqual(['error:a.ts:1', 'warning:b.ts:2']);
    expect(items[0]).toMatchObject({ fileId: idOf('a.ts'), source: 'ts', message: 'err' });
    stop();
    expect(useProblemsStore.getState().items).toEqual([]);
    expect(models.get('file:///a.ts')?.disposed).toBe(true);
  });
});

describe('editor themes', () => {
  it('defines all four named themes with valid hex colours and a background', () => {
    expect(Object.keys(EDITOR_THEMES).sort()).toEqual([
      'nexus-contrast',
      'nexus-graphite',
      'nexus-midnight',
      'nexus-paper',
    ]);
    for (const [name, spec] of Object.entries(EDITOR_THEMES)) {
      expect(['vs', 'vs-dark', 'hc-black']).toContain(spec.base);
      expect(spec.colors['editor.background'], name).toMatch(/^#[0-9a-f]{6}$/i);
      for (const colour of Object.values(spec.colors)) expect(colour).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      for (const [, foreground] of spec.tokens) expect(foreground).toMatch(/^[0-9a-f]{6}$/i);
    }
  });
});
