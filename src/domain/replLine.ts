export interface LineState {
  readonly buffer: string;
  readonly cursor: number;
  readonly history: readonly string[];
  /** Index into history while browsing with Up/Down; null when editing a fresh line */
  readonly browsing: number | null;
  readonly draft: string;
}

export interface LineResult {
  readonly state: LineState;
  /** A complete line the user submitted with Enter */
  readonly submit?: string;
  readonly interrupt?: boolean;
  readonly clearScreen?: boolean;
}

export const initialLine: LineState = { buffer: '', cursor: 0, history: [], browsing: null, draft: '' };
const MAX_HISTORY = 100;
const MAX_LINE = 4000;

/** Newlines become spaces (a pasted block is one line); other control characters are dropped. */
function printable(text: string): string {
  let out = '';
  for (const ch of text.replace(/[\r\n]+/g, ' ')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || (code >= 32 && code !== 127)) out += ch;
  }
  return out;
}

function insert(state: LineState, text: string): LineState {
  const clean = printable(text);
  const buffer = (state.buffer.slice(0, state.cursor) + clean + state.buffer.slice(state.cursor)).slice(0, MAX_LINE);
  return { ...state, buffer, cursor: Math.min(state.cursor + clean.length, buffer.length), browsing: null };
}

function recall(state: LineState, direction: 'up' | 'down'): LineState {
  const { history, browsing } = state;
  if (history.length === 0) return state;
  if (direction === 'up') {
    const next = browsing === null ? history.length - 1 : Math.max(0, browsing - 1);
    const draft = browsing === null ? state.buffer : state.draft;
    const buffer = history[next] as string;
    return { ...state, buffer, cursor: buffer.length, browsing: next, draft };
  }
  if (browsing === null) return state;
  if (browsing >= history.length - 1) {
    return { ...state, buffer: state.draft, cursor: state.draft.length, browsing: null };
  }
  const buffer = history[browsing + 1] as string;
  return { ...state, buffer, cursor: buffer.length, browsing: browsing + 1 };
}

function submit(state: LineState): LineResult {
  const line = state.buffer;
  const last = state.history[state.history.length - 1];
  const history = line.trim() === '' || line === last ? state.history : [...state.history, line].slice(-MAX_HISTORY);
  return { state: { ...initialLine, history }, submit: line };
}

const toStart = (s: LineState): LineState => ({ ...s, cursor: 0 });
const toEnd = (s: LineState): LineState => ({ ...s, cursor: s.buffer.length });

/** A Map so pasted text such as "constructor" or "toString" is never mistaken for a key sequence. */
const ESCAPES: ReadonlyMap<string, (s: LineState) => LineState> = new Map([
  ['\x1b[D', (s: LineState) => ({ ...s, cursor: Math.max(0, s.cursor - 1) })],
  ['\x1b[C', (s: LineState) => ({ ...s, cursor: Math.min(s.buffer.length, s.cursor + 1) })],
  ['\x1b[A', (s: LineState) => recall(s, 'up')],
  ['\x1b[B', (s: LineState) => recall(s, 'down')],
  ['\x1b[H', toStart],
  ['\x1b[1~', toStart],
  ['\x1b[F', toEnd],
  ['\x1b[4~', toEnd],
  ['\x1b[3~', (s: LineState) => ({ ...s, buffer: s.buffer.slice(0, s.cursor) + s.buffer.slice(s.cursor + 1) })],
]);

/** Applies one chunk from the terminal's `onData` (a keypress, an escape sequence, or pasted text). */
export function applyData(state: LineState, data: string): LineResult {
  const escape = ESCAPES.get(data);
  if (escape) return { state: escape(state) };
  switch (data) {
    case '\r':
      return submit(state);
    case '\x7f':
      return state.cursor === 0
        ? { state }
        : {
            state: {
              ...state,
              buffer: state.buffer.slice(0, state.cursor - 1) + state.buffer.slice(state.cursor),
              cursor: state.cursor - 1,
              browsing: null,
            },
          };
    case '\x03':
      return { state: { ...initialLine, history: state.history }, interrupt: true };
    case '\x0c':
      return { state, clearScreen: true };
    default:
      return data.startsWith('\x1b') ? { state } : { state: insert(state, data) };
  }
}
