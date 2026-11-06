import { useEffect } from 'react';
import { resolveTheme } from '@/domain/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { usePrefersDark } from './useMedia';

const THEME_COLOR: Record<string, string> = { graphite: '#14161a', paper: '#efeadf', contrast: '#000000' };

/** Mirrors the theme and motion settings onto <html> so CSS tokens and reduced-motion rules apply. */
export function useAppearance(): void {
  const theme = useSettingsStore(s => s.theme);
  const motion = useSettingsStore(s => s.motion);
  const prefersDark = usePrefersDark();
  useEffect(() => {
    const resolved = resolveTheme(theme, prefersDark);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.motion = motion === 'system' ? '' : motion;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved] ?? '#14161a');
  }, [theme, motion, prefersDark]);
}
