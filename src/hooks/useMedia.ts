import { useEffect, useState } from 'react';
import type { MotionChoice } from '@/domain/settings';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function usePrefersDark(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}

/** The Motion setting wins over the OS; `system` follows `prefers-reduced-motion`. */
export function useReducedMotion(choice: MotionChoice): boolean {
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (choice === 'reduce') return true;
  if (choice === 'full') return false;
  return system;
}

/** Below this width the workbench switches to a single-pane layout with bottom navigation. */
export const COMPACT_QUERY = '(max-width: 760px)';

export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}
