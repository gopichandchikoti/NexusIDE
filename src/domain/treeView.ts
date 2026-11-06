import { indexChildren, type FsNode, type FsState } from './fs';

export interface TreeRow {
  readonly node: FsNode;
  readonly depth: number;
  readonly expanded: boolean;
  readonly hasChildren: boolean;
}

/** Visible rows in display order. Folders are expanded unless their id is in `collapsed`. */
export function flattenTree(state: FsState, collapsed: ReadonlySet<string>): TreeRow[] {
  const children = indexChildren(state);
  const rows: TreeRow[] = [];
  const visit = (parentId: string | null, depth: number): void => {
    for (const node of children.get(parentId) ?? []) {
      const kids = children.get(node.id) ?? [];
      const expanded = node.kind === 'folder' && !collapsed.has(node.id);
      rows.push({ node, depth, expanded, hasChildren: kids.length > 0 });
      if (expanded) visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

export type TreeAction =
  | { readonly type: 'focus'; readonly index: number }
  | { readonly type: 'expand' | 'collapse' | 'rename' | 'delete' | 'menu'; readonly id: string }
  | { readonly type: 'open'; readonly id: string; readonly toggle: boolean };

/** Maps, not objects, so an inherited name like "constructor" can never match a key. */
const ROW_KEYS: ReadonlyMap<string, 'rename' | 'delete' | 'menu'> = new Map([
  ['F2', 'rename'],
  ['Delete', 'delete'],
  ['ContextMenu', 'menu'],
]);

function navigate(rows: readonly TreeRow[], index: number, key: string): TreeAction | null {
  const last = rows.length - 1;
  const target = new Map([
    ['ArrowDown', index + 1],
    ['ArrowUp', index - 1],
    ['Home', 0],
    ['End', last],
  ]).get(key);
  return target === undefined ? null : { type: 'focus', index: Math.max(0, Math.min(last, target)) };
}

function horizontal(rows: readonly TreeRow[], index: number, row: TreeRow, key: string): TreeAction | null {
  const isFolder = row.node.kind === 'folder';
  if (key === 'ArrowRight' && isFolder) {
    return row.expanded ? { type: 'focus', index: index + 1 } : { type: 'expand', id: row.node.id };
  }
  if (key !== 'ArrowLeft') return null;
  if (isFolder && row.expanded) return { type: 'collapse', id: row.node.id };
  const parent = rows.findIndex(r => r.node.id === row.node.parentId);
  return parent >= 0 ? { type: 'focus', index: parent } : null;
}

/** Maps a key press in the tree to what should happen. Pure so the keyboard contract is unit-tested. */
export function treeKeyAction(
  rows: readonly TreeRow[],
  index: number,
  key: string,
  shiftKey: boolean
): TreeAction | null {
  const moved = rows.length > 0 ? navigate(rows, index, key) : null;
  const row = rows[index];
  if (moved || !row) return moved;
  const id = row.node.id;
  if (key === 'Enter' || key === ' ') return { type: 'open', id, toggle: row.node.kind === 'folder' };
  const simple = ROW_KEYS.get(shiftKey && key === 'F10' ? 'ContextMenu' : key);
  return simple ? { type: simple, id } : horizontal(rows, index, row, key);
}

/** Ids of every ancestor folder of `id`, nearest first. Used to reveal a file in the tree. */
export function ancestorIds(state: FsState, id: string): string[] {
  const out: string[] = [];
  let current = state[id]?.parentId ?? null;
  while (current !== null && out.length < 32) {
    out.push(current);
    current = state[current]?.parentId ?? null;
  }
  return out;
}
