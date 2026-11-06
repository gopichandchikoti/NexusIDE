import { AlertCircle, Files, Keyboard, Search, SquareTerminal } from 'lucide-react';
import { countBySeverity, useProblemsStore } from '@/store/problemsStore';
import { useUiStore } from '@/store/uiStore';
import { IconButton } from '../ui/primitives';

export function ActivityRail() {
  const showSidebar = useUiStore(s => s.showSidebar);
  const panel = useUiStore(s => s.sidebarPanel);
  const showPanel = useUiStore(s => s.showPanel);
  const panelTab = useUiStore(s => s.panelTab);
  const problems = useProblemsStore(s => s.items);
  const errors = countBySeverity(problems).error;
  const ui = useUiStore.getState;
  const sidebar = (target: 'files' | 'search'): void => {
    if (showSidebar && panel === target) ui().setLayout({ showSidebar: false });
    else ui().showSidebarPanel(target);
  };
  const bottom = (target: 'problems' | 'terminal'): void => {
    if (showPanel && panelTab === target) ui().setLayout({ showPanel: false });
    else ui().showPanelTab(target);
  };
  return (
    <nav className="rail" aria-label="Views">
      <IconButton
        icon={Files}
        label="Explorer"
        pressed={showSidebar && panel === 'files'}
        onClick={() => sidebar('files')}
      />
      <IconButton
        icon={Search}
        label="Search"
        pressed={showSidebar && panel === 'search'}
        onClick={() => sidebar('search')}
      />
      <IconButton
        icon={AlertCircle}
        label="Problems"
        badge={errors}
        pressed={showPanel && panelTab === 'problems'}
        onClick={() => bottom('problems')}
      />
      <IconButton
        icon={SquareTerminal}
        label="Terminal (JavaScript REPL)"
        pressed={showPanel && panelTab === 'terminal'}
        onClick={() => bottom('terminal')}
      />
      <span className="rail__spacer" />
      <IconButton icon={Keyboard} label="Keyboard shortcuts" onClick={() => ui().setDialog({ shortcutsOpen: true })} />
    </nav>
  );
}
