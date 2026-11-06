import { Code2, Files, MonitorPlay, TerminalSquare, type LucideIcon } from 'lucide-react';
import { useUiStore, type MobileView } from '@/store/uiStore';
import { EditorArea } from '../editor/EditorArea';
import { BottomPanel } from '../panel/BottomPanel';
import { PreviewPane } from '../preview/PreviewPane';
import { FileTree } from '../files/FileTree';
import { SearchPanel } from '../search/SearchPanel';

const VIEWS: ReadonlyArray<{ id: MobileView; label: string; icon: LucideIcon }> = [
  { id: 'files', label: 'Files', icon: Files },
  { id: 'editor', label: 'Editor', icon: Code2 },
  { id: 'preview', label: 'Preview', icon: MonitorPlay },
  { id: 'console', label: 'Output', icon: TerminalSquare },
];

/**
 * Narrow screens: one pane at a time with bottom navigation. Every pane stays mounted (just hidden) so a running
 * preview, the editor's undo history and the terminal survive switching views.
 */
export function CompactWorkbench() {
  const view = useUiStore(s => s.mobileView);
  const sidebarPanel = useUiStore(s => s.sidebarPanel);
  return (
    <div className="compact">
      <div className="compact__views">
        <div className="compact__view" hidden={view !== 'files'}>
          <div className="segmented" role="group" aria-label="Sidebar view">
            {(['files', 'search'] as const).map(p => (
              <button
                key={p}
                type="button"
                aria-pressed={sidebarPanel === p}
                onClick={() => useUiStore.getState().setLayout({ sidebarPanel: p })}
              >
                {p === 'files' ? 'Explorer' : 'Search'}
              </button>
            ))}
          </div>
          {sidebarPanel === 'files' ? <FileTree /> : <SearchPanel />}
        </div>
        <div className="compact__view" hidden={view !== 'editor'}>
          <EditorArea />
        </div>
        <div className="compact__view" hidden={view !== 'preview'}>
          <PreviewPane compact />
        </div>
        <div className="compact__view" hidden={view !== 'console'}>
          <BottomPanel compact />
        </div>
      </div>
      <nav className="bottomnav" aria-label="Sections">
        {VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            className={`bottomnav__item${view === v.id ? ' is-active' : ''}`}
            aria-current={view === v.id ? 'page' : undefined}
            onClick={() => useUiStore.getState().setMobileView(v.id)}
          >
            <v.icon size={20} aria-hidden="true" />
            <span>{v.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
