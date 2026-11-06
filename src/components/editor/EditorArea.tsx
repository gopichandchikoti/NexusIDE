import { Suspense, lazy, useState } from 'react';
import { pathOf } from '@/domain/fs';
import { languageForPath } from '@/domain/languages';
import { useEditorStore } from '@/store/editorStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { Spinner } from '../ui/primitives';
import { EDITOR_PANEL_ID, Tabs } from './Tabs';
import { Welcome } from './Welcome';

const loadEditor = () => lazy(() => import('./MonacoView'));

function Crumb() {
  const active = useEditorStore(s => s.active);
  const structure = useWorkspaceStore(s => s.structure);
  void structure;
  const fs = useWorkspaceStore.getState().fs;
  if (!active || !fs[active]) return null;
  const path = pathOf(fs, active);
  return (
    <div className="crumb" aria-label="File path">
      <span className="truncate">{path.split('/').join(' / ')}</span>
      <span className="crumb__lang">{languageForPath(path).label}</span>
    </div>
  );
}

export function EditorArea() {
  const active = useEditorStore(s => s.active);
  // A fresh lazy() each retry: React caches a rejected import inside the previous one.
  const [Monaco, setMonaco] = useState(loadEditor);
  return (
    <section className="editor" aria-label="Editor">
      <Tabs />
      <Crumb />
      <div className="editor__body" id={EDITOR_PANEL_ID} role="tabpanel">
        {active ? (
          <ChunkBoundary what="The editor" onRetry={() => setMonaco(loadEditor)}>
            <Suspense
              fallback={
                <div className="editor__loading">
                  <Spinner label="Loading editor" /> Loading editor…
                </div>
              }
            >
              <Monaco />
            </Suspense>
          </ChunkBoundary>
        ) : (
          <Welcome />
        )}
      </div>
    </section>
  );
}
