import { confirmDelete, promptRename } from '@/app/fileActions';
import type { TreeAction, TreeRow } from '@/domain/treeView';

/** What the tree component offers to its actions: row lookup, focus movement, expansion and the context menu. */
export interface TreeContext {
  readonly rows: readonly TreeRow[];
  focusRow(id: string): void;
  open(row: TreeRow): void;
  toggle(id: string, expand?: boolean): void;
  showMenu(id: string): void;
}

function focusAt(ctx: TreeContext, index: number): void {
  const target = ctx.rows[index];
  if (target) ctx.focusRow(target.node.id);
}

function openRow(ctx: TreeContext, id: string, toggle: boolean): void {
  const row = ctx.rows.find(r => r.node.id === id);
  if (row) ctx.open(row);
  if (toggle) ctx.toggle(id);
}

/** Executes the outcome of `treeKeyAction` (keyboard) or a click (open). */
export function performTreeAction(action: TreeAction, ctx: TreeContext): void {
  switch (action.type) {
    case 'focus':
      return focusAt(ctx, action.index);
    case 'expand':
    case 'collapse':
      return ctx.toggle(action.id, action.type === 'expand');
    case 'open':
      return openRow(ctx, action.id, action.toggle);
    case 'rename':
      return promptRename(action.id);
    case 'delete':
      return confirmDelete(action.id);
    case 'menu':
      return ctx.showMenu(action.id);
  }
}
