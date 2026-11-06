import { fail, ok, type Result } from './errors';
import { deleteNode, renameNode, type FsDeps, type FsNode, type FsState } from './fs';

/**
 * A reversible file-tree change. Undo applies the inverse change to the CURRENT tree, so edits made to other
 * files in the meantime are never rolled back. (Text edits inside a file are undone by the editor itself.)
 */
export type FsChange =
  | { readonly kind: 'create'; readonly nodes: readonly FsNode[] }
  | { readonly kind: 'delete'; readonly nodes: readonly FsNode[] }
  | { readonly kind: 'rename'; readonly id: string; readonly from: string; readonly to: string };

export const HISTORY_LIMIT = 50;

export function invert(change: FsChange): FsChange {
  switch (change.kind) {
    case 'create':
      return { kind: 'delete', nodes: change.nodes };
    case 'delete':
      return { kind: 'create', nodes: change.nodes };
    case 'rename':
      return { kind: 'rename', id: change.id, from: change.to, to: change.from };
  }
}

export function describeChange(change: FsChange): string {
  switch (change.kind) {
    case 'create':
      return change.nodes.length === 1 ? `create ${change.nodes[0]?.name}` : `create ${change.nodes.length} items`;
    case 'delete':
      return change.nodes.length === 1 ? `delete ${change.nodes[0]?.name}` : `delete ${change.nodes.length} items`;
    case 'rename':
      return `rename ${change.from} to ${change.to}`;
  }
}

function restore(state: FsState, nodes: readonly FsNode[]): Result<FsState> {
  const next: Record<string, FsNode> = { ...state };
  const ids = new Set(nodes.map(n => n.id));
  for (const node of nodes) {
    const parentOk = node.parentId === null || ids.has(node.parentId) || next[node.parentId]?.kind === 'folder';
    const placed: FsNode = parentOk ? node : { ...node, parentId: null };
    const clash = Object.values(next).some(
      n => n.id !== placed.id && n.parentId === placed.parentId && n.name.toLowerCase() === placed.name.toLowerCase()
    );
    if (clash) return fail('DUPLICATE_NAME', `Can't restore "${node.name}": something with that name already exists.`);
    next[placed.id] = placed;
  }
  return ok(next);
}

function remove(state: FsState, nodes: readonly FsNode[]): Result<FsState> {
  let next = state;
  for (const node of nodes) {
    if (!next[node.id]) continue;
    const result = deleteNode(next, node.id);
    if (result.ok) next = result.value.state;
  }
  return ok(next);
}

export function applyChange(state: FsState, change: FsChange, deps?: FsDeps): Result<FsState> {
  switch (change.kind) {
    case 'create':
      return restore(state, change.nodes);
    case 'delete':
      return remove(state, change.nodes);
    case 'rename':
      return state[change.id]?.name === change.from
        ? renameNode(state, change.id, change.to, deps)
        : fail('NOT_FOUND', 'That item changed since, so the rename can no longer be undone.');
  }
}

export function pushHistory<T>(stack: readonly T[], entry: T): T[] {
  return [...stack, entry].slice(-HISTORY_LIMIT);
}
