import { Command, Loader2, Play, Settings, Square } from 'lucide-react';
import { runProject, stopProject } from '@/app/runActions';
import { formatChord, isMacPlatform } from '@/app/keymap';
import { isBusy } from '@/domain/runState';
import { useRunStore } from '@/store/runStore';
import { useUiStore } from '@/store/uiStore';
import { IconButton, Kbd } from '../ui/primitives';
import { Logo } from './Logo';

export function TitleBar({ compact }: { readonly compact: boolean }) {
  const run = useRunStore(s => s.run);
  const busy = isBusy(run);
  const mac = isMacPlatform();
  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <Logo />
        <span className="titlebar__name">NexusIDE</span>
      </div>

      {!compact && (
        <button
          type="button"
          className="titlebar__search"
          onClick={() => useUiStore.getState().openPalette('commands')}
        >
          <Command size={14} aria-hidden="true" />
          <span>Search commands and files</span>
          <Kbd>{formatChord('Mod+Shift+P', mac)}</Kbd>
        </button>
      )}

      <div className="titlebar__actions">
        {busy ? (
          <button type="button" className="btn btn--danger" onClick={stopProject}>
            <Square size={14} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void runProject()}
            title={`Run (${formatChord('Mod+Enter', mac)})`}
          >
            <Play size={14} aria-hidden="true" /> Run
          </button>
        )}
        {run.phase === 'building' && <Loader2 size={16} className="spin" aria-hidden="true" />}
        {compact && (
          <IconButton
            icon={Command}
            label="Command palette"
            onClick={() => useUiStore.getState().openPalette('commands')}
          />
        )}
        <IconButton
          icon={Settings}
          label="Settings"
          onClick={() => useUiStore.getState().setDialog({ settingsOpen: true })}
        />
      </div>
    </header>
  );
}
