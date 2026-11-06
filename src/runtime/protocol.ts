import { LIMITS } from '@/domain/limits';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** Everything the sandbox may tell the host. The host treats every field as untrusted input. */
export type SandboxEvent =
  | { type: 'ready' }
  | { type: 'booted' }
  | { type: 'done' }
  /** Heartbeat from a page preview. Its absence means the page hung or navigated away. */
  | { type: 'alive' }
  | { type: 'console'; level: ConsoleLevel; text: string }
  | { type: 'error'; message: string }
  | { type: 'repl-result'; id: number; ok: boolean; text: string };

/** Messages the host sends into the sandbox. */
export type HostMessage =
  | { source: 'nexus-host'; type: 'run-document'; html: string }
  | { source: 'nexus-host'; type: 'run-worker'; code: string }
  | { source: 'nexus-host'; type: 'to-worker'; payload: { id: number; code: string } };

const LEVELS: ReadonlySet<string> = new Set(['log', 'info', 'warn', 'error', 'debug']);

function clamp(text: string): string {
  return text.length > LIMITS.maxConsoleChars ? `${text.slice(0, LIMITS.maxConsoleChars)}… [truncated]` : text;
}

type Fields = Record<string, unknown>;
type EventParser = (data: Fields) => SandboxEvent | null;

function parseConsole(d: Fields): SandboxEvent | null {
  if (typeof d.level !== 'string' || !LEVELS.has(d.level) || typeof d.text !== 'string') return null;
  return { type: 'console', level: d.level as ConsoleLevel, text: clamp(d.text) };
}

function parseError(d: Fields): SandboxEvent | null {
  return typeof d.message === 'string' ? { type: 'error', message: clamp(d.message) } : null;
}

function parseReplResult(d: Fields): SandboxEvent | null {
  if (typeof d.id !== 'number' || !Number.isSafeInteger(d.id)) return null;
  if (typeof d.ok !== 'boolean' || typeof d.text !== 'string') return null;
  return { type: 'repl-result', id: d.id, ok: d.ok, text: clamp(d.text) };
}

/** A Map (not an object) so inherited names such as "constructor" or "__proto__" can never resolve to a parser. */
const PARSERS: ReadonlyMap<string, EventParser> = new Map<string, EventParser>([
  ['ready', () => ({ type: 'ready' })],
  ['booted', () => ({ type: 'booted' })],
  ['done', () => ({ type: 'done' })],
  ['alive', () => ({ type: 'alive' })],
  ['console', parseConsole],
  ['error', parseError],
  ['repl-result', parseReplResult],
]);

/** Returns a validated, size-clamped event, or null for anything that is not a well-formed sandbox message. */
export function parseSandboxEvent(data: unknown): SandboxEvent | null {
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Fields;
  if (fields.source !== 'nexus-sandbox' || typeof fields.type !== 'string') return null;
  return PARSERS.get(fields.type)?.(fields) ?? null;
}
