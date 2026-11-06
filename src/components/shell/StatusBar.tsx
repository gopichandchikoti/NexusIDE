import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, CloudOff, HardDrive, Loader2 } from 'lucide-react';
import { languageForPath } from '@/domain/languages';
import { pathOf } from '@/domain/fs';
import { estimateStorage, type StorageEstimate } from '@/services/workspaceRepo';
import { useEditorStore } from '@/store/editorStore';
import { countBySeverity, useProblemsStore } from '@/store/problemsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

const STORAGE_WARN_RATIO = 0.8;

function SaveState() {
  const ephemeral = useWorkspaceStore(s => s.ephemeral);
  const error = useWorkspaceStore(s => s.saveError);
  const dirty = useWorkspaceStore(s => s.dirty.size);
  const savedAt = useWorkspaceStore(s => s.lastSavedAt);
  const autoSave = useSettingsStore(s => s.autoSave);
  if (ephemeral) {
    return (
      <span className="status__item status__item--warn">
        <CloudOff size={13} aria-hidden="true" /> Not saved: browser storage unavailable
      </span>
    );
  }
  if (error) {
    return (
      <span className="status__item status__item--error">
        <AlertCircle size={13} aria-hidden="true" /> Save failed: {error.message}
      </span>
    );
  }
  if (dirty > 0) {
    return (
      <span className="status__item">
        <Loader2 size={13} className="spin" aria-hidden="true" /> {autoSave ? 'Saving…' : 'Unsaved changes (Ctrl+S)'}
      </span>
    );
  }
  return (
    <span className="status__item">
      <CheckCircle2 size={13} aria-hidden="true" />
      {savedAt ? ` Saved ${new Date(savedAt).toLocaleTimeString([], { hour12: false })}` : ' Up to date'}
    </span>
  );
}

function StorageWarning() {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const savedAt = useWorkspaceStore(s => s.lastSavedAt);
  useEffect(() => {
    void estimateStorage().then(setEstimate);
  }, [savedAt]);
  if (!estimate || estimate.quota === 0 || estimate.usage / estimate.quota < STORAGE_WARN_RATIO) return null;
  return (
    <span className="status__item status__item--warn">
      <HardDrive size={13} aria-hidden="true" /> Storage {Math.round((estimate.usage / estimate.quota) * 100)}% full
    </span>
  );
}

export function StatusBar() {
  const counts = countBySeverity(useProblemsStore(s => s.items));
  const cursor = useEditorStore(s => s.cursor);
  const active = useEditorStore(s => s.active);
  const structure = useWorkspaceStore(s => s.structure);
  const tabSize = useSettingsStore(s => s.tabSize);
  void structure;
  const fs = useWorkspaceStore.getState().fs;
  const language = active && fs[active] ? languageForPath(pathOf(fs, active)).label : null;
  return (
    <footer className="status" aria-label="Status bar">
      <div className="status__group" role="status">
        <SaveState />
        <StorageWarning />
      </div>
      <button
        type="button"
        className="status__item status__btn"
        onClick={() => useUiStore.getState().showPanelTab('problems')}
      >
        <AlertCircle size={13} aria-hidden="true" /> {counts.error} errors
        <AlertTriangle size={13} aria-hidden="true" /> {counts.warning} warnings
      </button>
      <span className="status__spacer" />
      {active && (
        <div className="status__group">
          <span className="status__item">
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <span className="status__item">Spaces: {tabSize}</span>
          {language && <span className="status__item">{language}</span>}
        </div>
      )}
    </footer>
  );
}
