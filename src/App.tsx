import { useRef, type DragEvent } from 'react';
import { importZipFile } from '@/app/workspaceActions';
import { mounts } from '@/app/services';
import { useAppearance } from '@/hooks/useAppearance';
import { useBoot } from '@/hooks/useBoot';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useCompactLayout } from '@/hooks/useMedia';
import { useUiStore } from '@/store/uiStore';
import { ConfirmDialogHost, NameDialogHost } from '@/components/files/Dialogs';
import { SettingsDialog } from '@/components/dialogs/SettingsDialog';
import { ShortcutsDialog, TemplatesDialog } from '@/components/dialogs/InfoDialogs';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { Banners } from '@/components/shell/Banners';
import { CompactWorkbench } from '@/components/shell/CompactWorkbench';
import { StatusBar } from '@/components/shell/StatusBar';
import { TitleBar } from '@/components/shell/TitleBar';
import { Workbench } from '@/components/shell/Workbench';
import { Toasts } from '@/components/ui/Toasts';
import { Spinner } from '@/components/ui/primitives';

function onDragOver(event: DragEvent): void {
  if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
}

function onDrop(event: DragEvent): void {
  const file = Array.from(event.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.zip'));
  event.preventDefault();
  if (file) void importZipFile(file);
  else if (event.dataTransfer.files.length > 0)
    useUiStore.getState().toast('info', 'Drop a .zip file to import a workspace.');
}

export function App() {
  useGlobalShortcuts();
  useAppearance();
  const ready = useBoot();
  const compact = useCompactLayout();
  const sandboxHost = useRef<HTMLDivElement | null>(null);

  return (
    <div className="app" onDragOver={onDragOver} onDrop={onDrop}>
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <TitleBar compact={compact} />
      <Banners />
      <main id="main" className="app__main" tabIndex={-1}>
        {!ready ? (
          <div className="boot" role="status">
            <Spinner label="Loading your workspace" /> Loading your workspace…
          </div>
        ) : compact ? (
          <CompactWorkbench />
        ) : (
          <Workbench />
        )}
      </main>
      {!compact && <StatusBar />}
      <NameDialogHost />
      <ConfirmDialogHost />
      <SettingsDialog />
      <ShortcutsDialog />
      <TemplatesDialog />
      <CommandPalette />
      <Toasts />
      <div
        id="sandbox-host"
        aria-hidden="true"
        ref={el => {
          sandboxHost.current = el;
          mounts.hidden = el;
        }}
      />
    </div>
  );
}
