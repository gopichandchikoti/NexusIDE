import { Suspense, lazy, useEffect, useState, type KeyboardEvent } from 'react';
import { Eraser, X } from 'lucide-react';
import { PANEL_TABS } from '@/domain/settings';
import { useProblemsStore, countBySeverity } from '@/store/problemsStore';
import { useRunStore } from '@/store/runStore';
import { useUiStore } from '@/store/uiStore';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { IconButton, Spinner } from '../ui/primitives';
import { ConsoleView } from './ConsoleView';
import { ProblemsView } from './ProblemsView';
import { RunChip } from './RunChip';

const loadTerminal = () => lazy(() => import('./TerminalView'));

const LABEL = { console: 'Console', problems: 'Problems', terminal: 'Terminal' } as const;

type PanelTab = (typeof PANEL_TABS)[number];

const selectTab = (next: PanelTab): void => useUiStore.getState().setLayout({ panelTab: next });

function PanelTabs({ tab }: { readonly tab: PanelTab }) {
  const problems = useProblemsStore(s => s.items);
  const counts = countBySeverity(problems);
  const onKeyDown = (event: KeyboardEvent): void => {
    const i = PANEL_TABS.indexOf(tab);
    const to = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : null;
    if (to === null) return;
    event.preventDefault();
    const next = PANEL_TABS[(to + PANEL_TABS.length) % PANEL_TABS.length];
    if (!next) return;
    selectTab(next);
    requestAnimationFrame(() => document.getElementById(`panel-tab-${next}`)?.focus());
  };
  return (
    <div className="panel__tabs" role="tablist" aria-label="Panel views" onKeyDown={onKeyDown}>
      {PANEL_TABS.map(name => (
        <button
          key={name}
          id={`panel-tab-${name}`}
          type="button"
          role="tab"
          aria-selected={tab === name}
          aria-controls={`panel-${name}`}
          tabIndex={tab === name ? 0 : -1}
          className={`panel__tab${tab === name ? ' is-active' : ''}`}
          onClick={() => selectTab(name)}
        >
          {LABEL[name]}
          {name === 'problems' && problems.length > 0 && (
            <span className="count" aria-label={`${counts.error} errors, ${counts.warning} warnings`}>
              {problems.length}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function BottomPanel({ compact = false }: { readonly compact?: boolean }) {
  const tab = useUiStore(s => s.panelTab);
  const [terminalSeen, setTerminalSeen] = useState(tab === 'terminal');

  const [TerminalView, setTerminal] = useState(loadTerminal);

  useEffect(() => {
    if (tab === 'terminal') setTerminalSeen(true);
  }, [tab]);

  return (
    <section className="panel" aria-label="Output panel">
      <div className="panel__head">
        <PanelTabs tab={tab} />
        <RunChip />
        <span className="panel__spacer" />
        {tab === 'console' && (
          <IconButton icon={Eraser} label="Clear console" onClick={() => useRunStore.getState().clear()} />
        )}
        {!compact && (
          <IconButton
            icon={X}
            label="Close panel"
            onClick={() => useUiStore.getState().setLayout({ showPanel: false })}
          />
        )}
      </div>
      <div className="panel__body">
        <div
          id="panel-console"
          role="tabpanel"
          aria-labelledby="panel-tab-console"
          hidden={tab !== 'console'}
          className="panel__view"
        >
          <ConsoleView />
        </div>
        <div
          id="panel-problems"
          role="tabpanel"
          aria-labelledby="panel-tab-problems"
          hidden={tab !== 'problems'}
          className="panel__view"
        >
          <ProblemsView />
        </div>
        <div
          id="panel-terminal"
          role="tabpanel"
          aria-labelledby="panel-tab-terminal"
          hidden={tab !== 'terminal'}
          className="panel__view"
        >
          {terminalSeen && (
            <ChunkBoundary what="The terminal" onRetry={() => setTerminal(loadTerminal)}>
              <Suspense fallback={<Spinner label="Loading terminal" />}>
                <TerminalView />
              </Suspense>
            </ChunkBoundary>
          )}
        </div>
      </div>
    </section>
  );
}
