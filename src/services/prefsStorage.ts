/**
 * localStorage for small per-browser preferences only (settings, layout). Workspace data lives in IndexedDB.
 * Every access is guarded: storage can be blocked, full, or hold hand-edited JSON.
 */
export function readPref(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

export function writePref(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removePref(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable; nothing to remove.
  }
}

export const PREF_KEYS = {
  settings: 'nexuside.settings.v1',
  layout: 'nexuside.layout.v1',
} as const;
