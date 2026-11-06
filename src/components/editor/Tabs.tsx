import { useRef, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { pathOf } from '@/domain/fs';
import { useEditorStore } from '@/store/editorStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

export const EDITOR_PANEL_ID = 'editor-panel';

export function Tabs() {
  const tabs = useEditorStore(s => s.tabs);
  const active = useEditorStore(s => s.active);
  const dirty = useWorkspaceStore(s => s.dirty);
  const structure = useWorkspaceStore(s => s.structure);
  const list = useRef<HTMLDivElement>(null);

  if (tabs.length === 0) return null;
  const { fs } = useWorkspaceStore.getState();
  const names = tabs.map(id => fs[id]?.name ?? '');
  void structure;

  const label = (id: string, index: number): string => {
    const name = names[index] ?? '';
    const clash = names.filter(n => n === name).length > 1;
    if (!clash) return name;
    const parent = pathOf(fs, id).split('/').slice(-2, -1)[0];
    return parent ? `${name} — ${parent}` : name;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const index = active ? tabs.indexOf(active) : -1;
    const select = (to: number): void => {
      const id = tabs[(to + tabs.length) % tabs.length];
      if (!id) return;
      event.preventDefault();
      useEditorStore.getState().setActive(id);
      list.current?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.focus();
    };
    if (event.key === 'ArrowRight') select(index + 1);
    else if (event.key === 'ArrowLeft') select(index - 1);
    else if (event.key === 'Home') select(0);
    else if (event.key === 'End') select(tabs.length - 1);
    else if (event.key === 'Delete' && active) useEditorStore.getState().closeTab(active);
  };

  return (
    <div ref={list} className="tabs" role="tablist" aria-label="Open files" onKeyDown={onKeyDown}>
      {tabs.map((id, index) => {
        const isActive = id === active;
        const isDirty = dirty.has(id);
        return (
          <div
            key={id}
            role="presentation"
            className={`tab${isActive ? ' is-active' : ''}`}
            onAuxClick={e => e.button === 1 && useEditorStore.getState().closeTab(id)}
          >
            <button
              type="button"
              role="tab"
              data-tab-id={id}
              aria-selected={isActive}
              aria-controls={EDITOR_PANEL_ID}
              aria-keyshortcuts="Delete"
              tabIndex={isActive ? 0 : -1}
              className="tab__label"
              title={`${names[index] ?? 'File'} (Delete or Alt+W closes the tab)`}
              onClick={() => useEditorStore.getState().setActive(id)}
            >
              <span className="truncate">{label(id, index)}</span>
              {isDirty && (
                <span className="tab__dirty" role="img" aria-label="unsaved changes" title="Unsaved changes">
                  ●
                </span>
              )}
            </button>
            {/* A tablist may only own tabs, so the mouse/touch close target is not a button here. Keyboard users
                close with Delete or Alt+W; the palette has "Close tab" too. */}
            <span className="tab__close" aria-hidden="true" onClick={() => useEditorStore.getState().closeTab(id)}>
              <X size={14} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
