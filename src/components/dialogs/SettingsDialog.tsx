import { useEffect, useId, useState } from 'react';
import { Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { exportWorkspaceZip, pickZipToImport, restoreBackupById, wipeEverything } from '@/app/workspaceActions';
import {
  EDITOR_THEMES,
  FONT_SIZE_RANGE,
  MOTION_CHOICES,
  RUN_TIMEOUT_RANGE_SEC,
  TAB_SIZES,
  THEMES,
  type AppSettings,
} from '@/domain/settings';
import { RUNTIME_VERSIONS } from '@/runtime/vendor';
import type { Backup } from '@/services/db';
import { deleteBackup, estimateStorage, listBackups, type StorageEstimate } from '@/services/workspaceRepo';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { Modal } from '../ui/Modal';

const THEME_LABEL: Record<(typeof THEMES)[number], string> = {
  system: 'Follow system',
  graphite: 'Graphite (dark)',
  paper: 'Paper (light)',
  contrast: 'High contrast',
};
const EDITOR_THEME_LABEL: Record<(typeof EDITOR_THEMES)[number], string> = {
  auto: 'Match app theme',
  graphite: 'Graphite',
  paper: 'Paper',
  contrast: 'High contrast',
  midnight: 'Midnight',
};
const MOTION_LABEL: Record<(typeof MOTION_CHOICES)[number], string> = {
  system: 'Follow system',
  reduce: 'Reduce motion',
  full: 'Full motion',
};

function Select<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly T[];
  readonly names: Record<T, string>;
  readonly onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="setting">
      <label htmlFor={id} className="setting__label">
        {props.label}
      </label>
      <select id={id} className="field__input" value={props.value} onChange={e => props.onChange(e.target.value as T)}>
        {props.options.map(o => (
          <option key={o} value={o}>
            {props.names[o]}
          </option>
        ))}
      </select>
    </div>
  );
}

function Switch(props: {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="setting">
      <label htmlFor={id} className="setting__label">
        {props.label}
        {props.hint && <span className="setting__hint">{props.hint}</span>}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={props.checked}
        onChange={e => props.onChange(e.target.checked)}
      />
    </div>
  );
}

function NumberInput(props: {
  readonly label: string;
  readonly hint?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div className="setting">
      <label htmlFor={id} className="setting__label">
        {props.label}
        {props.hint && <span className="setting__hint">{props.hint}</span>}
      </label>
      <input
        id={id}
        type="number"
        className="field__input field__input--narrow"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={e => e.target.value !== '' && props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

function DataSection() {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [backups, setBackups] = useState<readonly Backup[]>([]);
  const refresh = (): void => {
    void estimateStorage().then(setEstimate);
    void listBackups().then(r => setBackups(r.ok ? r.value : []));
  };
  useEffect(refresh, []);
  const mb = (n: number): string => (n / 1_000_000).toFixed(1);
  return (
    <section aria-labelledby="set-data">
      <h3 id="set-data">Your data</h3>
      <p className="setting__note">
        Everything is stored in this browser (IndexedDB). Nothing is uploaded. Clearing site data deletes it, so export
        a ZIP for anything important.
      </p>
      {estimate && estimate.quota > 0 && (
        <p className="setting__note">
          <meter min={0} max={estimate.quota} value={estimate.usage} aria-label="Browser storage used" />{' '}
          {mb(estimate.usage)} MB of about {mb(estimate.quota)} MB used by this site.
        </p>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={() => void exportWorkspaceZip()}>
          <Download size={15} aria-hidden="true" /> Export ZIP
        </button>
        <button type="button" className="btn" onClick={pickZipToImport}>
          <Upload size={15} aria-hidden="true" /> Import ZIP
        </button>
      </div>
      <h4>Automatic backups</h4>
      <p className="setting__note">
        Taken before a template, import or restore replaces your files. The newest 5 are kept.
      </p>
      {backups.length === 0 ? (
        <p className="setting__note">No backups yet.</p>
      ) : (
        <ul className="backups">
          {backups.map(b => (
            <li key={b.id}>
              <span>
                <strong>{new Date(b.createdAt).toLocaleString([], { hour12: false })}</strong> · {b.label} ·{' '}
                {b.nodes.filter(n => n.kind === 'file').length} files
              </span>
              <button type="button" className="btn" onClick={() => void restoreBackupById(b.id as number)}>
                <RotateCcw size={14} aria-hidden="true" /> Restore
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                aria-label={`Delete backup from ${new Date(b.createdAt).toLocaleString()}`}
                onClick={() => void deleteBackup(b.id as number).then(refresh)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <h4>Delete everything</h4>
      <button
        type="button"
        className="btn btn--danger"
        onClick={() =>
          useUiStore.getState().askConfirm({
            title: 'Delete all NexusIDE data?',
            message:
              'This removes your files, backups, drafts and settings from this browser. It cannot be undone. Export a ZIP first if you want to keep anything.',
            confirmLabel: 'Delete everything',
            danger: true,
            onConfirm: () => void wipeEverything(),
          })
        }
      >
        <Trash2 size={15} aria-hidden="true" /> Delete all data…
      </button>
    </section>
  );
}

type Patch = (patch: Partial<AppSettings>) => void;

function AppearanceSection({ s, set }: { readonly s: AppSettings; readonly set: Patch }) {
  const dock = useUiStore(st => st.previewDock);
  return (
    <section aria-labelledby="set-look">
      <h3 id="set-look">Appearance</h3>
      <Select label="Theme" value={s.theme} options={THEMES} names={THEME_LABEL} onChange={theme => set({ theme })} />
      <Select
        label="Editor theme"
        value={s.editorTheme}
        options={EDITOR_THEMES}
        names={EDITOR_THEME_LABEL}
        onChange={editorTheme => set({ editorTheme })}
      />
      <Select
        label="Motion"
        value={s.motion}
        options={MOTION_CHOICES}
        names={MOTION_LABEL}
        onChange={motion => set({ motion })}
      />
      <Select
        label="Preview position"
        value={dock}
        options={['right', 'bottom'] as const}
        names={{ right: 'Right of the editor', bottom: 'Below the editor' }}
        onChange={previewDock => useUiStore.getState().setLayout({ previewDock })}
      />
    </section>
  );
}

function EditorSection({ s, set }: { readonly s: AppSettings; readonly set: Patch }) {
  return (
    <section aria-labelledby="set-editor">
      <h3 id="set-editor">Editor</h3>
      <NumberInput
        label="Font size"
        hint={`${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max} px`}
        value={s.fontSize}
        min={FONT_SIZE_RANGE.min}
        max={FONT_SIZE_RANGE.max}
        onChange={fontSize => set({ fontSize })}
      />
      <Select
        label="Indent size"
        value={String(s.tabSize) as '2' | '4' | '8'}
        options={TAB_SIZES.map(String) as Array<'2' | '4' | '8'>}
        names={{ '2': '2 spaces', '4': '4 spaces', '8': '8 spaces' }}
        onChange={v => set({ tabSize: Number(v) as AppSettings['tabSize'] })}
      />
      <Switch label="Word wrap" checked={s.wordWrap} onChange={wordWrap => set({ wordWrap })} />
      <Switch label="Minimap" checked={s.minimap} onChange={minimap => set({ minimap })} />
      <Switch label="Line numbers" checked={s.lineNumbers} onChange={lineNumbers => set({ lineNumbers })} />
    </section>
  );
}

function SavingSection({ s, set }: { readonly s: AppSettings; readonly set: Patch }) {
  return (
    <section aria-labelledby="set-save">
      <h3 id="set-save">Saving and running</h3>
      <Switch
        label="Autosave"
        hint="Off: edits stay in this session and in crash-recovery drafts until Ctrl+S"
        checked={s.autoSave}
        onChange={autoSave => set({ autoSave })}
      />
      <Switch label="Format on save" checked={s.formatOnSave} onChange={formatOnSave => set({ formatOnSave })} />
      <NumberInput
        label="Run timeout"
        hint={`${RUN_TIMEOUT_RANGE_SEC.min}–${RUN_TIMEOUT_RANGE_SEC.max} seconds. Console programs stop after this long; page previews stop if they go unresponsive this long.`}
        value={s.runTimeoutSec}
        min={RUN_TIMEOUT_RANGE_SEC.min}
        max={RUN_TIMEOUT_RANGE_SEC.max}
        onChange={runTimeoutSec => set({ runTimeoutSec })}
      />
    </section>
  );
}

function AboutSection({ onReset }: { readonly onReset: () => void }) {
  return (
    <section aria-labelledby="set-about">
      <h3 id="set-about">About</h3>
      <p className="setting__note">
        NexusIDE 1.0.0. Preview runtime: React {RUNTIME_VERSIONS.react}, React DOM {RUNTIME_VERSIONS['react-dom']}{' '}
        (bundled; no network needed). Runs HTML, CSS, JavaScript, TypeScript and React in a browser sandbox. Not a
        replacement for VS Code: no Node, npm, shell, debugger or extensions.
      </p>
      <button type="button" className="btn" onClick={onReset}>
        Reset settings to defaults
      </button>
    </section>
  );
}

export function SettingsDialog() {
  const open = useUiStore(s => s.settingsOpen);
  const s = useSettingsStore();
  return (
    <Modal
      open={open}
      title="Settings"
      onClose={() => useUiStore.getState().setDialog({ settingsOpen: false })}
      width={640}
    >
      <div className="settings">
        <AppearanceSection s={s} set={s.update} />
        <EditorSection s={s} set={s.update} />
        <SavingSection s={s} set={s.update} />
        <DataSection />
        <AboutSection onReset={s.reset} />
      </div>
    </Modal>
  );
}
