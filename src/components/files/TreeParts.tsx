import {
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FileCode2,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Pencil,
  Trash2,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { confirmDelete, promptNew, promptRename, undoTree } from '@/app/fileActions';
import { exportWorkspaceZip, pickZipToImport } from '@/app/workspaceActions';
import { languageForPath } from '@/domain/languages';
import type { TreeRow } from '@/domain/treeView';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { EmptyState, IconButton } from '../ui/primitives';

const CODE_LANGS = new Set([
  'html',
  'css',
  'javascript',
  'typescript',
  'python',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'shell',
]);

function iconFor(row: TreeRow): LucideIcon {
  if (row.node.kind === 'folder') return row.expanded ? FolderOpen : Folder;
  const id = languageForPath(row.node.name).id;
  if (id === 'json') return FileJson;
  if (id === 'markdown' || id === 'plaintext') return FileText;
  return CODE_LANGS.has(id) ? FileCode2 : FileIcon;
}

export function TreeToolbar({ selected }: { readonly selected: string | null }) {
  const canUndo = useWorkspaceStore(s => s.past.length > 0);
  return (
    <div className="tree__toolbar" role="toolbar" aria-label="Explorer actions">
      <IconButton icon={FilePlus} label="New file" onClick={() => promptNew('file')} />
      <IconButton icon={FolderPlus} label="New folder" onClick={() => promptNew('folder')} />
      <IconButton icon={Pencil} label="Rename selected" disabled={!selected} onClick={() => promptRename(selected)} />
      <IconButton icon={Trash2} label="Delete selected" disabled={!selected} onClick={() => confirmDelete(selected)} />
      <IconButton icon={Undo2} label="Undo file operation" disabled={!canUndo} onClick={undoTree} />
      <span className="tree__spacer" />
      <IconButton icon={Download} label="Export workspace as ZIP" onClick={() => void exportWorkspaceZip()} />
      <IconButton icon={Upload} label="Import ZIP" onClick={pickZipToImport} />
    </div>
  );
}

export function EmptyTree() {
  return (
    <EmptyState
      icon={FolderTree}
      title="No files yet"
      actions={
        <>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => useUiStore.getState().setDialog({ templatesOpen: true })}
          >
            Start from a template
          </button>
          <button type="button" className="btn" onClick={() => promptNew('file', null)}>
            New file
          </button>
        </>
      }
    >
      Create a file, import a ZIP, or begin with a template.
    </EmptyState>
  );
}

interface RowProps {
  readonly row: TreeRow;
  readonly selected: boolean;
  readonly active: boolean;
  readonly tabbable: boolean;
  readonly onActivate: () => void;
  readonly onContextMenu: (event: MouseEvent) => void;
  /** Keeps the tree's idea of "current row" in step with DOM focus (Tab, click, assistive tech). */
  readonly onFocus: () => void;
}

export function TreeRowItem({ row, selected, active, tabbable, onActivate, onContextMenu, onFocus }: RowProps) {
  const { node } = row;
  const Icon = iconFor(row);
  const isFolder = node.kind === 'folder';
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  return (
    <div
      data-node-id={node.id}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={isFolder ? row.expanded : undefined}
      aria-selected={selected}
      aria-current={active ? 'true' : undefined}
      tabIndex={tabbable ? 0 : -1}
      className={`tree__row${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
      style={{ paddingInlineStart: 8 + row.depth * 16 }}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      onFocus={onFocus}
    >
      {isFolder ? <Chevron size={14} aria-hidden="true" /> : <span className="tree__gap" />}
      <Icon size={16} aria-hidden="true" strokeWidth={1.6} />
      <span className="tree__name">{node.name}</span>
    </div>
  );
}
