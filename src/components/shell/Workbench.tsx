import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUiStore } from '@/store/uiStore';
import { EditorArea } from '../editor/EditorArea';
import { FileTree } from '../files/FileTree';
import { BottomPanel } from '../panel/BottomPanel';
import { PreviewPane } from '../preview/PreviewPane';
import { SearchPanel } from '../search/SearchPanel';
import { ActivityRail } from './ActivityRail';

function Handle({ direction }: { readonly direction: 'horizontal' | 'vertical' }) {
  return <PanelResizeHandle className={`handle handle--${direction}`} aria-label="Resize panel" />;
}

export function Sidebar() {
  const panel = useUiStore(s => s.sidebarPanel);
  return <div className="sidebar">{panel === 'files' ? <FileTree /> : <SearchPanel />}</div>;
}

function EditorAndPreview() {
  const showPreview = useUiStore(s => s.showPreview);
  const dock = useUiStore(s => s.previewDock);
  const axis = dock === 'right' ? 'horizontal' : 'vertical';
  return (
    <PanelGroup direction={axis} autoSaveId={`nexus-editor-${dock}`}>
      <Panel id="editor" order={1} minSize={25}>
        <EditorArea />
      </Panel>
      {showPreview && (
        <>
          <Handle direction={axis === 'horizontal' ? 'horizontal' : 'vertical'} />
          <Panel id="preview" order={2} defaultSize={40} minSize={15}>
            <PreviewPane />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}

/** Desktop layout: rail | sidebar | (editor + preview) over the output panel. All regions resize and persist. */
export function Workbench() {
  const showSidebar = useUiStore(s => s.showSidebar);
  const showPanel = useUiStore(s => s.showPanel);
  return (
    <div className="workbench">
      <ActivityRail />
      <PanelGroup direction="horizontal" autoSaveId="nexus-main" className="workbench__groups">
        {showSidebar && (
          <>
            <Panel id="sidebar" order={1} defaultSize={22} minSize={14} maxSize={45}>
              <Sidebar />
            </Panel>
            <Handle direction="horizontal" />
          </>
        )}
        <Panel id="center" order={2} minSize={30}>
          <PanelGroup direction="vertical" autoSaveId="nexus-center">
            <Panel id="top" order={1} minSize={25}>
              <EditorAndPreview />
            </Panel>
            {showPanel && (
              <>
                <Handle direction="vertical" />
                <Panel id="bottom" order={2} defaultSize={28} minSize={10}>
                  <BottomPanel />
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
