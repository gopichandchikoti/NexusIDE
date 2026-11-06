export interface Chord {
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** `Mod` is Ctrl on Windows/Linux and Cmd on macOS. Example: "Mod+Shift+P". */
export function parseChord(spec: string): Chord {
  const parts = spec.split('+');
  const key = (parts[parts.length - 1] ?? '').toLowerCase();
  const lower = parts.slice(0, -1).map(p => p.toLowerCase());
  return { key, mod: lower.includes('mod'), shift: lower.includes('shift'), alt: lower.includes('alt') };
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
}

export function chordMatches(event: KeyEventLike, chord: Chord, mac: boolean): boolean {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const wrongMod = mac ? event.ctrlKey : event.metaKey;
  if (wrongMod || mod !== chord.mod || event.shiftKey !== chord.shift || event.altKey !== chord.alt) return false;
  return event.key.toLowerCase() === chord.key;
}

const MAC_GLYPHS: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥' };

export function formatChord(spec: string, mac: boolean): string {
  const parts = spec.split('+');
  const key = parts[parts.length - 1] ?? '';
  const pretty = key.length === 1 ? key.toUpperCase() : key;
  const mods = parts.slice(0, -1).map(p => p.toLowerCase());
  if (mac) return [...mods.map(m => MAC_GLYPHS[m] ?? m), pretty].join('');
  return [...mods.map(m => (m === 'mod' ? 'Ctrl' : m === 'alt' ? 'Alt' : 'Shift')), pretty].join('+');
}
