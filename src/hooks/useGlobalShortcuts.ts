import { useEffect } from 'react';
import { buildCommands } from '@/app/commands';
import { chordMatches, isMacPlatform, parseChord, type Chord } from '@/app/keymap';

interface Binding {
  readonly chord: Chord;
  readonly run: () => void | Promise<void>;
}

/**
 * One capture-phase listener for every command shortcut. Capture runs before Monaco sees the key, so app-level
 * chords (Ctrl+S, Ctrl+P, Ctrl+Enter...) win over editor defaults and over the browser's own handling.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const mac = isMacPlatform();
    const bindings: Binding[] = buildCommands().flatMap(command =>
      [command.keys, ...(command.alsoKeys ?? [])]
        .filter((spec): spec is string => spec !== undefined)
        .map(spec => ({ chord: parseChord(spec), run: command.run }))
    );
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      const hit = bindings.find(b => chordMatches(event, b.chord, mac));
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      void hit.run();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
