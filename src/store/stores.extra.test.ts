import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/limits';
import { countBySeverity, MAX_PROBLEMS, useProblemsStore, type Problem } from './problemsStore';
import { useRunStore } from './runStore';
import { useUiStore } from './uiStore';

const problem = (n: number, severity: Problem['severity'] = 'error'): Problem => ({
  key: `k${n}`,
  fileId: 'f',
  path: 'a.ts',
  line: n,
  column: 1,
  severity,
  message: `m${n}`,
});

beforeEach(() => {
  useProblemsStore.setState({ items: [] });
  useRunStore.setState({ lines: [] });
});

describe('problemsStore', () => {
  it('stores problems, caps them, and counts by severity', () => {
    useProblemsStore
      .getState()
      .set([problem(1), problem(2, 'warning'), problem(3, 'info'), problem(4, 'hint'), problem(5)]);
    expect(countBySeverity(useProblemsStore.getState().items)).toEqual({ error: 2, warning: 1, info: 1, hint: 1 });
    useProblemsStore.getState().set(Array.from({ length: MAX_PROBLEMS + 50 }, (_, i) => problem(i)));
    expect(useProblemsStore.getState().items).toHaveLength(MAX_PROBLEMS);
  });
});

describe('runStore', () => {
  it('appends single and batched lines with unique ids and keeps only the newest', () => {
    const { log, logMany, clear } = useRunStore.getState();
    log('system', 'one');
    logMany([
      { level: 'log', text: 'two' },
      { level: 'error', text: 'three' },
    ]);
    const lines = useRunStore.getState().lines;
    expect(lines.map(l => l.text)).toEqual(['one', 'two', 'three']);
    expect(new Set(lines.map(l => l.id)).size).toBe(3);
    logMany(
      Array.from({ length: LIMITS.maxConsoleMessages + 100 }, (_, i) => ({ level: 'log' as const, text: `n${i}` }))
    );
    expect(useRunStore.getState().lines).toHaveLength(LIMITS.maxConsoleMessages);
    expect(useRunStore.getState().lines.at(-1)?.text).toBe(`n${LIMITS.maxConsoleMessages + 99}`);
    clear();
    expect(useRunStore.getState().lines).toEqual([]);
  });

  it('feeds events through the run reducer', () => {
    useRunStore.getState().dispatch({ type: 'start', runId: 1, mode: 'script', entry: 'a.ts', now: 1 });
    expect(useRunStore.getState().run.phase).toBe('building');
  });
});

describe('uiStore', () => {
  it('opens and closes the palette and dialogs, and switches panes', () => {
    const ui = useUiStore.getState();
    ui.openPalette('files');
    expect(useUiStore.getState().palette).toBe('files');
    ui.closePalette();
    expect(useUiStore.getState().palette).toBeNull();
    ui.showSidebarPanel('search');
    expect(useUiStore.getState()).toMatchObject({ sidebarPanel: 'search', showSidebar: true, mobileView: 'files' });
    ui.showPanelTab('terminal');
    expect(useUiStore.getState()).toMatchObject({ panelTab: 'terminal', showPanel: true, mobileView: 'console' });
    ui.setMobileView('preview');
    ui.askConfirm({ title: 't', message: 'm', confirmLabel: 'c', onConfirm: () => undefined });
    expect(useUiStore.getState().confirm?.title).toBe('t');
    ui.askConfirm(null);
    expect(useUiStore.getState().confirm).toBeNull();
  });
});
