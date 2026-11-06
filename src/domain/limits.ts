/** Hard limits that protect the browser tab and IndexedDB quota. Surfaced to users, never silently applied. */
export const LIMITS = {
  maxFiles: 500,
  maxFileBytes: 1_000_000,
  maxWorkspaceBytes: 20_000_000,
  maxDepth: 10,
  maxNameLength: 255,
  maxSearchResults: 500,
  maxSearchLineChars: 300,
  maxZipEntries: 600,
  maxZipExpandedBytes: 25_000_000,
  maxConsoleMessages: 500,
  maxConsoleChars: 4_000,
  backupsKept: 5,
  defaultRunTimeoutMs: 10_000,
  minRunTimeoutMs: 1_000,
  maxRunTimeoutMs: 60_000,
  largeFileBytes: 300_000,
} as const;

const encoder = new TextEncoder();

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}
