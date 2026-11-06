import { FilePlus, FolderOpen, Keyboard, Upload } from 'lucide-react';
import { promptNew } from '@/app/fileActions';
import { pickZipToImport, startFromTemplate } from '@/app/workspaceActions';
import { TEMPLATES } from '@/data/templates';
import { listLanguages } from '@/domain/languages';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { RUNTIME_VERSIONS } from '@/runtime/vendor';

const RUN_LABEL = { page: 'Runs as a page', console: 'Runs as a console program', nothing: 'Edit only' } as const;

/** Shown when no file is open. On a first run this is the start screen; later it is a quiet launcher. */
export function Welcome() {
  const hasFiles = useWorkspaceStore(s => Object.keys(s.fs).length > 0);
  const editOnly = listLanguages()
    .filter(l => l.runnable === 'none')
    .map(l => l.label);
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <h1>{hasFiles ? 'Pick up where you left off' : 'Write, run and preview small projects in your browser'}</h1>
        <p className="welcome__lede">
          {hasFiles
            ? 'Open a file from the Explorer, or start something new.'
            : 'Everything stays on this device. Your code runs in an isolated sandbox with no network access.'}
        </p>

        <div className="welcome__actions">
          <button type="button" className="btn btn--primary" onClick={() => promptNew('file')}>
            <FilePlus size={16} aria-hidden="true" /> New file
          </button>
          <button type="button" className="btn" onClick={pickZipToImport}>
            <Upload size={16} aria-hidden="true" /> Import ZIP
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => useUiStore.getState().openPalette('files')}
            disabled={!hasFiles}
          >
            <FolderOpen size={16} aria-hidden="true" /> Go to file
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => useUiStore.getState().setDialog({ shortcutsOpen: true })}
          >
            <Keyboard size={16} aria-hidden="true" /> Shortcuts
          </button>
        </div>

        <h2 className="welcome__h2">Starter templates</h2>
        <ul className="templates" aria-label="Starter templates">
          {TEMPLATES.map(t => (
            <li key={t.id}>
              <button type="button" className="template" onClick={() => startFromTemplate(t.id)}>
                <span className="template__name">{t.name}</span>
                <span className="template__summary">{t.summary}</span>
                <span className="template__meta">
                  {RUN_LABEL[t.runs]}
                  {t.tags.length > 0 && ` · ${t.tags.join(' · ')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="welcome__note">
          <strong>What runs:</strong> HTML, CSS, JavaScript, TypeScript and React {RUNTIME_VERSIONS.react} (bundled,
          works offline). <strong>Edit only:</strong> {editOnly.join(', ')}. There is no Node, no npm install and no
          shell.
        </p>
      </div>
    </div>
  );
}
