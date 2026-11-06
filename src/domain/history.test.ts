import { describe, expect, it } from 'vitest';
import { fromEntries, type FsNode, type FsState } from './fs';
import { applyChange, describeChange, invert, pushHistory, HISTORY_LIMIT, type FsChange } from './history';

function seed(files: Record<string, string>): FsState {
  const r = fromEntries(Object.entries(files).map(([path, content]) => ({ path, kind: 'file' as const, content })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const find = (fs: FsState, name: string): FsNode => Object.values(fs).find(n => n.name === name) as FsNode;

describe('history', () => {
  it('inverts every change kind and describes it for the undo toast', () => {
    const node = find(seed({ 'a.ts': '' }), 'a.ts');
    expect(invert({ kind: 'create', nodes: [node] })).toEqual({ kind: 'delete', nodes: [node] });
    expect(invert({ kind: 'delete', nodes: [node] })).toEqual({ kind: 'create', nodes: [node] });
    expect(invert({ kind: 'rename', id: 'x', from: 'a', to: 'b' })).toEqual({
      kind: 'rename',
      id: 'x',
      from: 'b',
      to: 'a',
    });
    expect(describeChange({ kind: 'delete', nodes: [node] })).toBe('delete a.ts');
    expect(describeChange({ kind: 'create', nodes: [node, node] })).toBe('create 2 items');
    expect(describeChange({ kind: 'rename', id: 'x', from: 'a', to: 'b' })).toBe('rename a to b');
  });

  it('refuses to restore over a name that is now taken, leaving the tree unchanged', () => {
    const before = seed({ 'a.ts': 'old' });
    const removed = find(before, 'a.ts');
    const current = seed({ 'a.ts': 'brand new' });
    const r = applyChange(current, { kind: 'create', nodes: [removed] });
    expect(!r.ok && r.error.code).toBe('DUPLICATE_NAME');
  });

  it('re-roots restored nodes whose parent no longer exists', () => {
    const fs = seed({ 'dir/x.ts': 'x' });
    const child = find(fs, 'x.ts');
    const r = applyChange({}, { kind: 'create', nodes: [child] });
    expect(r.ok && r.value[child.id]?.parentId).toBeNull();
  });

  it('refuses a rename undo when the item changed since', () => {
    const fs = seed({ 'a.ts': '' });
    const id = find(fs, 'a.ts').id;
    // History says the file was renamed zzz -> other.ts, but it is currently called a.ts (changed since).
    const change: FsChange = { kind: 'rename', id, from: 'zzz', to: 'other.ts' };
    const r = applyChange(fs, invert(change));
    expect(!r.ok && r.error.code).toBe('NOT_FOUND');
  });

  it('ignores nodes that are already gone when deleting', () => {
    const fs = seed({ 'a.ts': '' });
    const ghost = { ...find(fs, 'a.ts'), id: 'ghost' };
    const r = applyChange(fs, { kind: 'delete', nodes: [ghost] });
    expect(r.ok && Object.keys(r.value)).toHaveLength(1);
  });

  it('caps the history length', () => {
    let stack: number[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) stack = pushHistory(stack, i);
    expect(stack).toHaveLength(HISTORY_LIMIT);
    expect(stack[stack.length - 1]).toBe(HISTORY_LIMIT + 9);
  });
});
