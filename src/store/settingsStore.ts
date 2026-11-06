import { create } from 'zustand';
import { DEFAULT_SETTINGS, parseSettings, type AppSettings } from '@/domain/settings';
import { PREF_KEYS, readPref, removePref, writePref } from '@/services/prefsStorage';

export interface SettingsStore extends AppSettings {
  update(patch: Partial<AppSettings>): void;
  reset(): void;
}

function pick(state: SettingsStore): AppSettings {
  const { update: _update, reset: _reset, ...settings } = state;
  return settings;
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  ...parseSettings(readPref(PREF_KEYS.settings)),
  update(patch) {
    const next = parseSettings({ ...pick(get()), ...patch });
    set(next);
    writePref(PREF_KEYS.settings, next);
  },
  reset() {
    set(DEFAULT_SETTINGS);
    removePref(PREF_KEYS.settings);
  },
}));

export function currentSettings(): AppSettings {
  return pick(useSettingsStore.getState());
}
