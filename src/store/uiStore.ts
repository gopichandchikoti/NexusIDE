import { create } from 'zustand';
import { DEFAULT_LAYOUT, parseLayout, type LayoutPrefs } from '@/domain/settings';
import { PREF_KEYS, readPref, writePref } from '@/services/prefsStorage';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export type PaletteMode = 'commands' | 'files';
export type MobileView = 'files' | 'editor' | 'preview' | 'console';
export type NameDialog =
  | { readonly mode: 'file' | 'folder'; readonly parentId: string | null }
  | { readonly mode: 'rename'; readonly id: string };

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly action?: { readonly label: string; readonly run: () => void };
}

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
}

export interface UiStore extends LayoutPrefs {
  readonly palette: PaletteMode | null;
  readonly settingsOpen: boolean;
  readonly shortcutsOpen: boolean;
  readonly templatesOpen: boolean;
  readonly nameDialog: NameDialog | null;
  readonly confirm: ConfirmRequest | null;
  readonly mobileView: MobileView;
  readonly toasts: readonly Toast[];
  /** Node highlighted in the file tree; "New file" is created next to it */
  readonly selectedNodeId: string | null;

  selectNode(id: string | null): void;
  setLayout(patch: Partial<LayoutPrefs>): void;
  showSidebarPanel(panel: LayoutPrefs['sidebarPanel']): void;
  showPanelTab(tab: LayoutPrefs['panelTab']): void;
  openPalette(mode: PaletteMode): void;
  closePalette(): void;
  setDialog(patch: Partial<Pick<UiStore, 'settingsOpen' | 'shortcutsOpen' | 'templatesOpen'>>): void;
  openNameDialog(dialog: NameDialog | null): void;
  askConfirm(request: ConfirmRequest | null): void;
  setMobileView(view: MobileView): void;
  toast(kind: ToastKind, message: string, action?: Toast['action']): number;
  dismissToast(id: number): void;
}

let toastCounter = 0;
const MAX_TOASTS = 4;
const LIFETIME_MS: Record<ToastKind, number> = { info: 4500, success: 3500, warning: 7000, error: 9000 };

function layoutOf(state: UiStore): LayoutPrefs {
  const { showSidebar, sidebarPanel, showPanel, panelTab, showPreview, previewDock } = state;
  return { showSidebar, sidebarPanel, showPanel, panelTab, showPreview, previewDock };
}

export const useUiStore = create<UiStore>()((set, get) => ({
  ...parseLayout(readPref(PREF_KEYS.layout)),
  palette: null,
  settingsOpen: false,
  shortcutsOpen: false,
  templatesOpen: false,
  nameDialog: null,
  confirm: null,
  mobileView: 'editor',
  toasts: [],
  selectedNodeId: null,

  selectNode: id => set({ selectedNodeId: id }),
  setLayout: patch => set(patch),
  showSidebarPanel: panel => set({ sidebarPanel: panel, showSidebar: true, mobileView: 'files' }),
  showPanelTab: tab => set({ panelTab: tab, showPanel: true, mobileView: 'console' }),
  openPalette: mode => set({ palette: mode }),
  closePalette: () => set({ palette: null }),
  setDialog: patch => set(patch),
  openNameDialog: dialog => set({ nameDialog: dialog }),
  askConfirm: request => set({ confirm: request }),
  setMobileView: view => set({ mobileView: view }),

  toast(kind, message, action) {
    const id = ++toastCounter;
    set(s => ({ toasts: [...s.toasts, { id, kind, message, action }].slice(-MAX_TOASTS) }));
    setTimeout(() => get().dismissToast(id), LIFETIME_MS[kind]);
    return id;
  },
  dismissToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

useUiStore.subscribe((state, prev) => {
  const next = layoutOf(state);
  const before = layoutOf(prev);
  if ((Object.keys(next) as Array<keyof LayoutPrefs>).some(k => next[k] !== before[k])) {
    writePref(PREF_KEYS.layout, next);
  }
});

export { DEFAULT_LAYOUT };
