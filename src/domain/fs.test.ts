import { describe, expect, it } from 'vitest';
import {
  createNode,
  deleteNode,
  findByPath,
  fromEntries,
  indexChildren,
  pathOf,
  renameNode,
  toEntries,
  totalBytes,
  updateContent,
  validateName,
  type FsDeps,
  type FsState,
} from './fs';
import { LIMITS } from './limits';

function makeDeps(): FsDeps {
  let n = 0;
  return { newId: () => `id-${++n}`, now: () => 1_700_000_000_000 };
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
}

describe('validateName', () => {
  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'bad\u0000name', 'tab\tname'])('rejects %j', name => {
    const r = validateName(name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_NAME');
  });

  it('rejects names over the limit and accepts the limit exactly', () => {
    expect(validateName('a'.repeat(LIMITS.maxNameLength + 1)).ok).toBe(false);
    expect(validateName('a'.repeat(LIMITS.maxNameLength)).ok).toBe(true);
  });

  it('trims surrounding whitespace and keeps dotfiles and unicode', () => {
    expect(must(validateName('  .gitignore '))).toBe('.gitignore');
    expect(must(validateName('café.ts'))).toBe('café.ts');
  });
});

describe('createNode / renameNode / deleteNode', () => {
  const deps = makeDeps();
  const base = (): FsState => ({});

  it('creates nested nodes and computes paths', () => {
    const a = must(createNode(base(), { parentId: null, name: 'src', kind: 'folder' }, deps));
    const b = must(createNode(a.state, { parentId: a.node.id, name: 'main.ts', kind: 'file', content: 'x' }, deps));
    expect(pathOf(b.state, b.node.id)).toBe('src/main.ts');
    expect(findByPath(b.state, 'src/main.ts')?.id).toBe(b.node.id);
    expect(findByPath(b.state, 'src/missing.ts')).toBeUndefined();
  });

  it('rejects duplicates case-insensitively among siblings only', () => {
    const a = must(createNode(base(), { parentId: null, name: 'README.md', kind: 'file' }, deps));
    const dup = createNode(a.state, { parentId: null, name: 'readme.MD', kind: 'file' }, deps);
    expect(!dup.ok && dup.error.code).toBe('DUPLICATE_NAME');
    const folder = must(createNode(a.state, { parentId: null, name: 'docs', kind: 'folder' }, deps));
    expect(createNode(folder.state, { parentId: folder.node.id, name: 'README.md', kind: 'file' }, deps).ok).toBe(true);
  });

  it('rejects a missing or non-folder parent', () => {
    const f = must(createNode(base(), { parentId: null, name: 'a.txt', kind: 'file' }, deps));
    const underFile = createNode(f.state, { parentId: f.node.id, name: 'b', kind: 'file' }, deps);
    expect(!underFile.ok && underFile.error.code).toBe('NOT_FOUND');
    const missing = createNode(f.state, { parentId: 'nope', name: 'b', kind: 'file' }, deps);
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
  });

  it('enforces depth, file count and file size limits', () => {
    let state: FsState = {};
    let parent: string | null = null;
    for (let i = 0; i < LIMITS.maxDepth; i++) {
      const made: { state: FsState; node: { id: string } } = must(
        createNode(state, { parentId: parent, name: `d${i}`, kind: 'folder' }, deps)
      );
      state = made.state;
      parent = made.node.id;
    }
    const tooDeep = createNode(state, { parentId: parent, name: 'x', kind: 'folder' }, deps);
    expect(!tooDeep.ok && tooDeep.error.code).toBe('LIMIT_EXCEEDED');

    const big = createNode(
      {},
      { parentId: null, name: 'big.txt', kind: 'file', content: 'a'.repeat(LIMITS.maxFileBytes + 1) },
      deps
    );
    expect(!big.ok && big.error.code).toBe('LIMIT_EXCEEDED');

    const many: Record<string, string> = {};
    for (let i = 0; i <= LIMITS.maxFiles; i++) many[`f${i}.txt`] = '';
    const r = fromEntries(
      Object.entries(many).map(([path, content]) => ({ path, kind: 'file' as const, content })),
      deps
    );
    expect(!r.ok && r.error.code).toBe('LIMIT_EXCEEDED');
  });

  it('renames keeping the id, and rejects clashes but allows case-only change of itself', () => {
    const a = must(createNode(base(), { parentId: null, name: 'a.ts', kind: 'file' }, deps));
    const b = must(createNode(a.state, { parentId: null, name: 'b.ts', kind: 'file' }, deps));
    const clash = renameNode(b.state, b.node.id, 'A.ts', deps);
    expect(!clash.ok && clash.error.code).toBe('DUPLICATE_NAME');
    const same = must(renameNode(b.state, a.node.id, 'A.ts', deps));
    expect(same[a.node.id]?.name).toBe('A.ts');
    expect(same[a.node.id]?.id).toBe(a.node.id);
  });

  it('deletes a folder with all descendants', () => {
    const f = must(createNode(base(), { parentId: null, name: 'src', kind: 'folder' }, deps));
    const g = must(createNode(f.state, { parentId: f.node.id, name: 'lib', kind: 'folder' }, deps));
    const h = must(createNode(g.state, { parentId: g.node.id, name: 'x.ts', kind: 'file' }, deps));
    const keep = must(createNode(h.state, { parentId: null, name: 'keep.ts', kind: 'file' }, deps));
    const del = must(deleteNode(keep.state, f.node.id));
    expect(Object.keys(del.state)).toEqual([keep.node.id]);
    expect(del.removed).toHaveLength(3);
    const missing = deleteNode(del.state, 'nope');
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
  });
});

describe('updateContent and totals', () => {
  it('returns the same state object when content is unchanged and rejects oversize', () => {
    const deps = makeDeps();
    const a = must(createNode({}, { parentId: null, name: 'a.txt', kind: 'file', content: 'hi' }, deps));
    expect(must(updateContent(a.state, a.node.id, 'hi', deps))).toBe(a.state);
    const big = updateContent(a.state, a.node.id, 'x'.repeat(LIMITS.maxFileBytes + 1), deps);
    expect(!big.ok && big.error.code).toBe('LIMIT_EXCEEDED');
    expect(totalBytes(a.state)).toBe(2);
  });
});

describe('fromEntries / toEntries', () => {
  const deps = makeDeps();
  const file = (path: string, content = '') => ({ path, kind: 'file' as const, content });

  it('creates missing parent folders and roundtrips, keeping empty folders', () => {
    const r = must(
      fromEntries([file('a/b/c.ts', 'c'), file('top.md', 'm'), { path: 'empty/', kind: 'folder' as const }], deps)
    );
    const entries = toEntries(r)
      .map(e => `${e.kind}:${e.path}`)
      .sort();
    expect(entries).toEqual(['file:a/b/c.ts', 'file:top.md', 'folder:a', 'folder:a/b', 'folder:empty']);
  });

  it.each(['../evil.txt', 'a/../../evil', '/abs.txt', 'a\\b.txt', 'a//b.txt', './x', 'C:/x'])(
    'rejects unsafe path %j',
    path => {
      const r = fromEntries([file(path)], deps);
      expect(!r.ok && r.error.code).toBe('INVALID_PATH');
    }
  );

  it('rejects a path that is both a file and a folder', () => {
    const r = fromEntries([file('a', 'x'), file('a/b.ts', 'y')], deps);
    expect(r.ok).toBe(false);
  });

  it('sorts children folders first then naturally', () => {
    const state = must(
      fromEntries([file('b10.ts'), file('b2.ts'), file('Z.ts'), { path: 'zdir', kind: 'folder' as const }], deps)
    );
    const names = (indexChildren(state).get(null) ?? []).map(n => n.name);
    expect(names).toEqual(['zdir', 'b2.ts', 'b10.ts', 'Z.ts']);
  });
});
