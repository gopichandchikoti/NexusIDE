import { describe, expect, it } from 'vitest';
import { buildCommands } from './commands';
import { chordMatches, formatChord, parseChord, type KeyEventLike } from './keymap';

const key = (over: Partial<KeyEventLike> & { key: string }): KeyEventLike => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('keymap', () => {
  it('parses chords and matches Ctrl on Windows/Linux and Cmd on macOS', () => {
    const save = parseChord('Mod+S');
    expect(chordMatches(key({ key: 's', ctrlKey: true }), save, false)).toBe(true);
    expect(chordMatches(key({ key: 'S', ctrlKey: true }), save, false)).toBe(true);
    expect(chordMatches(key({ key: 's', metaKey: true }), save, false)).toBe(false);
    expect(chordMatches(key({ key: 's', metaKey: true }), save, true)).toBe(true);
    expect(chordMatches(key({ key: 's', ctrlKey: true }), save, true)).toBe(false);
  });

  it('requires modifiers to match exactly', () => {
    const palette = parseChord('Mod+Shift+P');
    expect(chordMatches(key({ key: 'P', ctrlKey: true, shiftKey: true }), palette, false)).toBe(true);
    expect(chordMatches(key({ key: 'p', ctrlKey: true }), palette, false)).toBe(false);
    expect(chordMatches(key({ key: 'p', ctrlKey: true, shiftKey: true, altKey: true }), palette, false)).toBe(false);
    expect(chordMatches(key({ key: 'F1' }), parseChord('F1'), false)).toBe(true);
    expect(chordMatches(key({ key: 'Enter', ctrlKey: true }), parseChord('Mod+Enter'), false)).toBe(true);
  });

  it('formats chords per platform', () => {
    expect(formatChord('Mod+Shift+P', false)).toBe('Ctrl+Shift+P');
    expect(formatChord('Mod+Shift+P', true)).toBe('⌘⇧P');
    expect(formatChord('Alt+N', false)).toBe('Alt+N');
    expect(formatChord('F1', false)).toBe('F1');
  });
});

describe('command registry', () => {
  const commands = buildCommands();

  it('has unique ids and titles', () => {
    expect(new Set(commands.map(c => c.id)).size).toBe(commands.length);
    expect(new Set(commands.map(c => `${c.category}:${c.title}`)).size).toBe(commands.length);
  });

  it('has no two commands sharing a chord', () => {
    const chords = commands.flatMap(c => [c.keys, ...(c.alsoKeys ?? [])]).filter(Boolean) as string[];
    const normalised = chords.map(c => JSON.stringify(parseChord(c)));
    expect(new Set(normalised).size).toBe(normalised.length);
  });

  it('covers the required v1.0 command surface', () => {
    const ids = commands.map(c => c.id);
    for (const required of [
      'file.new',
      'file.rename',
      'file.delete',
      'file.save',
      'view.palette',
      'file.quickOpen',
      'search.global',
      'run.run',
      'run.stop',
      'workspace.template',
      'workspace.export',
      'workspace.import',
      'view.terminal',
    ]) {
      expect(ids).toContain(required);
    }
  });
});
