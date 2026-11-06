import { describe, expect, it } from 'vitest';
import { fromEntries, type FsState } from './fs';
import { applyData, initialLine, type LineState } from './replLine';
import { ancestorIds, flattenTree, treeKeyAction } from './treeView';

function seed(paths: string[]): FsState {
  const r = fromEntries(paths.map(path => ({ path, kind: 'file' as const, content: '' })));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe('flattenTree', () => {
  const fs = seed(['src/App.tsx', 'src/lib/util.ts', 'index.html', 'z.txt']);
  const idOf = (name: string): string => Object.values(fs).find(n => n.name === name)?.id ?? '';

  it('lists folders first, depth-first, expanded by default', () => {
    const rows = flattenTree(fs, new Set());
    expect(rows.map(r => `${'  '.repeat(r.depth)}${r.node.name}`)).toEqual([
      'src',
      '  lib',
      '    util.ts',
      '  App.tsx',
      'index.html',
      'z.txt',
    ]);
  });

  it('hides the children of collapsed folders and reports expansion state', () => {
    const rows = flattenTree(fs, new Set([idOf('src')]));
    expect(rows.map(r => r.node.name)).toEqual(['src', 'index.html', 'z.txt']);
    expect(rows[0]).toMatchObject({ expanded: false, hasChildren: true });
  });

  it('finds ancestors nearest first', () => {
    expect(ancestorIds(fs, idOf('util.ts')).map(id => fs[id]?.name)).toEqual(['lib', 'src']);
    expect(ancestorIds(fs, idOf('z.txt'))).toEqual([]);
    expect(ancestorIds(fs, 'missing')).toEqual([]);
  });
});

describe('treeKeyAction', () => {
  const fs = seed(['src/App.tsx', 'index.html']);
  const rows = flattenTree(fs, new Set());
  // rows: src (folder, 0), App.tsx (1), index.html (2)
  const act = (index: number, key: string, shift = false) => treeKeyAction(rows, index, key, shift);

  it('moves focus with arrows, Home and End, clamped to the list', () => {
    expect(act(0, 'ArrowDown')).toEqual({ type: 'focus', index: 1 });
    expect(act(0, 'ArrowUp')).toEqual({ type: 'focus', index: 0 });
    expect(act(2, 'ArrowDown')).toEqual({ type: 'focus', index: 2 });
    expect(act(1, 'Home')).toEqual({ type: 'focus', index: 0 });
    expect(act(0, 'End')).toEqual({ type: 'focus', index: 2 });
  });

  it('expands, enters and collapses folders, and walks back to the parent', () => {
    const collapsed = flattenTree(fs, new Set([rows[0]?.node.id as string]));
    expect(treeKeyAction(collapsed, 0, 'ArrowRight', false)).toEqual({ type: 'expand', id: rows[0]?.node.id });
    expect(act(0, 'ArrowRight')).toEqual({ type: 'focus', index: 1 });
    expect(act(0, 'ArrowLeft')).toEqual({ type: 'collapse', id: rows[0]?.node.id });
    expect(act(1, 'ArrowLeft')).toEqual({ type: 'focus', index: 0 });
    expect(act(2, 'ArrowLeft')).toBeNull();
    expect(act(1, 'ArrowRight')).toBeNull();
  });

  it('opens, renames, deletes and opens the menu for the focused row', () => {
    expect(act(0, 'Enter')).toEqual({ type: 'open', id: rows[0]?.node.id, toggle: true });
    expect(act(2, ' ')).toEqual({ type: 'open', id: rows[2]?.node.id, toggle: false });
    expect(act(1, 'F2')).toEqual({ type: 'rename', id: rows[1]?.node.id });
    expect(act(1, 'Delete')).toEqual({ type: 'delete', id: rows[1]?.node.id });
    expect(act(1, 'ContextMenu')).toEqual({ type: 'menu', id: rows[1]?.node.id });
    expect(act(1, 'F10', true)).toEqual({ type: 'menu', id: rows[1]?.node.id });
    expect(act(1, 'F10', false)).toBeNull();
  });

  it('ignores keys when there are no rows or no focused row', () => {
    expect(treeKeyAction([], 0, 'ArrowDown', false)).toBeNull();
    expect(act(-1, 'Enter')).toBeNull();
    expect(act(1, 'x')).toBeNull();
    for (const inherited of ['constructor', '__proto__', 'toString']) expect(act(1, inherited)).toBeNull();
  });
});

describe('REPL line editor', () => {
  const type = (state: LineState, text: string): LineState => {
    let s = state;
    for (const ch of text) s = applyData(s, ch).state;
    return s;
  };

  it('inserts, moves the cursor, deletes and backspaces', () => {
    let s = type(initialLine, 'helo');
    s = applyData(s, '\x1b[D').state;
    s = type(s, 'l');
    expect(s).toMatchObject({ buffer: 'hello', cursor: 4 });
    s = applyData(s, '\x7f').state;
    expect(s.buffer).toBe('helo');
    s = applyData(applyData(s, '\x1b[H').state, '\x1b[3~').state;
    expect(s).toMatchObject({ buffer: 'elo', cursor: 0 });
    expect(applyData(s, '\x7f').state).toBe(s);
    expect(applyData(s, '\x1b[F').state.cursor).toBe(3);
  });

  it('submits a line, records history without duplicates or blanks, and resets the buffer', () => {
    let r = applyData(type(initialLine, '1+1'), '\r');
    expect(r.submit).toBe('1+1');
    expect(r.state).toMatchObject({ buffer: '', cursor: 0, history: ['1+1'] });
    r = applyData(type(r.state, '1+1'), '\r');
    expect(r.state.history).toEqual(['1+1']);
    r = applyData(type(r.state, '   '), '\r');
    expect(r.state.history).toEqual(['1+1']);
  });

  it('browses history with Up/Down and restores the unfinished draft', () => {
    let s: LineState = { ...initialLine, history: ['a', 'bb'] };
    s = type(s, 'dra');
    s = applyData(s, '\x1b[A').state;
    expect(s.buffer).toBe('bb');
    s = applyData(s, '\x1b[A').state;
    expect(s.buffer).toBe('a');
    s = applyData(s, '\x1b[A').state;
    expect(s.buffer).toBe('a');
    s = applyData(s, '\x1b[B').state;
    expect(s.buffer).toBe('bb');
    s = applyData(s, '\x1b[B').state;
    expect(s).toMatchObject({ buffer: 'dra', browsing: null });
    expect(applyData(initialLine, '\x1b[A').state).toBe(initialLine);
  });

  it('treats pasted words that match Object.prototype names as plain text', () => {
    for (const word of ['constructor', 'toString', '__proto__', 'valueOf']) {
      expect(applyData(initialLine, word).state.buffer).toBe(word);
    }
  });

  it('handles Ctrl+C, Ctrl+L, pasted text with newlines, and ignores unknown escape sequences', () => {
    const typed = type(initialLine, 'abc');
    expect(applyData(typed, '\x03')).toMatchObject({ interrupt: true, state: { buffer: '' } });
    expect(applyData(typed, '\x0c').clearScreen).toBe(true);
    expect(applyData(initialLine, 'a\nb\r\nc').state.buffer).toBe('a b c');
    expect(applyData(typed, '\x1b[99~').state).toBe(typed);
    expect(applyData(initialLine, 'x'.repeat(5000)).state.buffer).toHaveLength(4000);
  });
});
