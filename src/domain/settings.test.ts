import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  parseLayout,
  parseSettings,
  resolveEditorTheme,
  resolveTheme,
} from './settings';

describe('parseSettings', () => {
  it('returns defaults for non-objects, arrays and null', () => {
    for (const bad of [undefined, null, 5, 'x', [], true]) expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back per field instead of crashing on an unknown theme from a newer or older version', () => {
    const s = parseSettings({ theme: 'solarized', fontSize: 'big', tabSize: 3, wordWrap: 'yes', autoSave: false });
    expect(s).toMatchObject({ theme: 'system', fontSize: 14, tabSize: 2, wordWrap: false, autoSave: false });
  });

  it('clamps numeric fields into their allowed range', () => {
    expect(parseSettings({ fontSize: 3 }).fontSize).toBe(10);
    expect(parseSettings({ fontSize: 99 }).fontSize).toBe(28);
    expect(parseSettings({ runTimeoutSec: 0 }).runTimeoutSec).toBe(1);
    expect(parseSettings({ runTimeoutSec: 9999 }).runTimeoutSec).toBe(60);
    expect(parseSettings({ fontSize: Number.NaN }).fontSize).toBe(14);
  });

  it('keeps valid values', () => {
    const valid = {
      ...DEFAULT_SETTINGS,
      theme: 'paper',
      editorTheme: 'midnight',
      tabSize: 8,
      motion: 'reduce',
    } as const;
    expect(parseSettings(valid)).toEqual(valid);
  });
});

describe('themes and layout', () => {
  it('resolves system theme from the OS preference and maps editor themes', () => {
    expect(resolveTheme('system', true)).toBe('graphite');
    expect(resolveTheme('system', false)).toBe('paper');
    expect(resolveTheme('contrast', true)).toBe('contrast');
    expect(resolveEditorTheme('auto', 'paper')).toBe('nexus-paper');
    expect(resolveEditorTheme('midnight', 'paper')).toBe('nexus-midnight');
  });

  it('validates layout preferences', () => {
    expect(parseLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout({ panelTab: 'debug', previewDock: 'bottom', showSidebar: false })).toMatchObject({
      panelTab: 'console',
      previewDock: 'bottom',
      showSidebar: false,
    });
  });
});
