import { LIMITS } from './limits';

export const THEMES = ['system', 'graphite', 'paper', 'contrast'] as const;
export const EDITOR_THEMES = ['auto', 'graphite', 'paper', 'contrast', 'midnight'] as const;
export const MOTION_CHOICES = ['system', 'reduce', 'full'] as const;
export const TAB_SIZES = [2, 4, 8] as const;

export type ThemeChoice = (typeof THEMES)[number];
export type EditorThemeChoice = (typeof EDITOR_THEMES)[number];
export type MotionChoice = (typeof MOTION_CHOICES)[number];
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

export interface AppSettings {
  readonly theme: ThemeChoice;
  readonly editorTheme: EditorThemeChoice;
  readonly fontSize: number;
  readonly tabSize: (typeof TAB_SIZES)[number];
  readonly wordWrap: boolean;
  readonly minimap: boolean;
  readonly lineNumbers: boolean;
  readonly autoSave: boolean;
  readonly formatOnSave: boolean;
  readonly runTimeoutSec: number;
  readonly motion: MotionChoice;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  editorTheme: 'auto',
  fontSize: 14,
  tabSize: 2,
  wordWrap: false,
  minimap: false,
  lineNumbers: true,
  autoSave: true,
  formatOnSave: false,
  runTimeoutSec: LIMITS.defaultRunTimeoutMs / 1000,
  motion: 'system',
};

export const FONT_SIZE_RANGE = { min: 10, max: 28 } as const;
export const RUN_TIMEOUT_RANGE_SEC = {
  min: LIMITS.minRunTimeoutMs / 1000,
  max: LIMITS.maxRunTimeoutMs / 1000,
} as const;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Accepts anything (corrupt, old or hand-edited storage) and returns a complete, valid settings object. */
export function parseSettings(raw: unknown): AppSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const tab = TAB_SIZES.find(t => t === o.tabSize) ?? d.tabSize;
  return {
    theme: pick(o.theme, THEMES, d.theme),
    editorTheme: pick(o.editorTheme, EDITOR_THEMES, d.editorTheme),
    fontSize: clampNumber(o.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, d.fontSize),
    tabSize: tab,
    wordWrap: bool(o.wordWrap, d.wordWrap),
    minimap: bool(o.minimap, d.minimap),
    lineNumbers: bool(o.lineNumbers, d.lineNumbers),
    autoSave: bool(o.autoSave, d.autoSave),
    formatOnSave: bool(o.formatOnSave, d.formatOnSave),
    runTimeoutSec: clampNumber(o.runTimeoutSec, RUN_TIMEOUT_RANGE_SEC.min, RUN_TIMEOUT_RANGE_SEC.max, d.runTimeoutSec),
    motion: pick(o.motion, MOTION_CHOICES, d.motion),
  };
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'graphite' : 'paper';
  return choice;
}

export type MonacoThemeName = 'nexus-graphite' | 'nexus-paper' | 'nexus-contrast' | 'nexus-midnight';

export function resolveEditorTheme(choice: EditorThemeChoice, appTheme: ResolvedTheme): MonacoThemeName {
  return `nexus-${choice === 'auto' ? appTheme : choice}` as MonacoThemeName;
}

/** Layout the user can customise; persisted separately from editor settings. */
export const SIDEBAR_PANELS = ['files', 'search'] as const;
export const PANEL_TABS = ['console', 'problems', 'terminal'] as const;
export const PREVIEW_DOCKS = ['right', 'bottom'] as const;

export interface LayoutPrefs {
  readonly showSidebar: boolean;
  readonly sidebarPanel: (typeof SIDEBAR_PANELS)[number];
  readonly showPanel: boolean;
  readonly panelTab: (typeof PANEL_TABS)[number];
  readonly showPreview: boolean;
  readonly previewDock: (typeof PREVIEW_DOCKS)[number];
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  showSidebar: true,
  sidebarPanel: 'files',
  showPanel: true,
  panelTab: 'console',
  showPreview: true,
  previewDock: 'right',
};

export function parseLayout(raw: unknown): LayoutPrefs {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LAYOUT;
  return {
    showSidebar: bool(o.showSidebar, d.showSidebar),
    sidebarPanel: pick(o.sidebarPanel, SIDEBAR_PANELS, d.sidebarPanel),
    showPanel: bool(o.showPanel, d.showPanel),
    panelTab: pick(o.panelTab, PANEL_TABS, d.panelTab),
    showPreview: bool(o.showPreview, d.showPreview),
    previewDock: pick(o.previewDock, PREVIEW_DOCKS, d.previewDock),
  };
}
