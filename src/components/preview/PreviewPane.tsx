import { useCallback, useEffect, useRef } from 'react';
import { MonitorPlay, PanelBottom, PanelRight, RotateCw, Square, X } from 'lucide-react';
import { runProject, stopProject } from '@/app/runActions';
import { mounts } from '@/app/services';
import { isBusy } from '@/domain/runState';
import { useRunStore } from '@/store/runStore';
import { useUiStore } from '@/store/uiStore';
import { EmptyState, IconButton } from '../ui/primitives';

function PreviewOverlay({ failed }: { readonly failed: string | null | undefined }) {
  return (
    <div className="preview__overlay">
      <EmptyState
        icon={MonitorPlay}
        title={failed ? 'The preview could not start' : 'Nothing running'}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => void runProject()}>
            Run
          </button>
        }
      >
        {failed ?? 'Press Run to preview your page here. It runs in an isolated sandbox with no network access.'}
      </EmptyState>
    </div>
  );
}

export function PreviewPane({ compact = false }: { readonly compact?: boolean }) {
  const run = useRunStore(s => s.run);
  const dock = useUiStore(s => s.previewDock);
  const host = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null): void => {
    host.current = el;
    mounts.preview = el;
  }, []);

  useEffect(() => {
    const element = host.current;
    // Effect setup must restore registration after StrictMode or an older hot-reloaded cleanup clears it.
    mounts.preview = element;
    return () => {
      if (mounts.preview === element) mounts.preview = null;
      const current = useRunStore.getState().run;
      if (!compact && current.mode === 'preview' && isBusy(current)) stopProject();
    };
  }, [compact]);

  const showing = run.mode === 'preview' && isBusy(run);
  const failed = run.mode === 'preview' && run.phase === 'failed' ? run.error?.message : null;
  const dockRight = dock === 'right';
  return (
    <section className="preview" aria-label="Preview">
      <div className="preview__head">
        <h2 className="preview__title">Preview</h2>
        <span className="preview__entry truncate">{showing ? run.entry : ''}</span>
        <span className="panel__spacer" />
        <IconButton icon={RotateCw} label="Run again" onClick={() => void runProject()} />
        <IconButton icon={Square} label="Stop" disabled={!isBusy(run)} onClick={stopProject} />
        {!compact && (
          <>
            <IconButton
              icon={dockRight ? PanelBottom : PanelRight}
              label={dockRight ? 'Dock preview below the editor' : 'Dock preview to the right'}
              onClick={() => useUiStore.getState().setLayout({ previewDock: dockRight ? 'bottom' : 'right' })}
            />
            <IconButton
              icon={X}
              label="Close preview"
              onClick={() => useUiStore.getState().setLayout({ showPreview: false })}
            />
          </>
        )}
      </div>
      <div className="preview__body">
        <div ref={attach} className="preview__mount" />
        {!showing && <PreviewOverlay failed={failed} />}
      </div>
    </section>
  );
}
