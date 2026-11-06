/**
 * Supported-language scope (Milestone 1).
 * - `preview`: can be shown in the DOM preview sandbox (HTML pages and the scripts/styles they load).
 * - `script`: can run as a console program in the sandboxed Worker.
 * - `none`: edit-only (syntax highlighting, no execution). NexusIDE never claims to run these.
 */
export type Runnable = 'preview' | 'script' | 'none';

export interface LanguageInfo {
  /** Monaco language id */
  readonly id: string;
  readonly label: string;
  readonly runnable: Runnable;
}

const PLAIN: LanguageInfo = { id: 'plaintext', label: 'Plain text', runnable: 'none' };

const EXTENSIONS: Readonly<Record<string, LanguageInfo>> = {
  html: { id: 'html', label: 'HTML', runnable: 'preview' },
  htm: { id: 'html', label: 'HTML', runnable: 'preview' },
  css: { id: 'css', label: 'CSS', runnable: 'none' },
  js: { id: 'javascript', label: 'JavaScript', runnable: 'script' },
  mjs: { id: 'javascript', label: 'JavaScript', runnable: 'script' },
  cjs: { id: 'javascript', label: 'JavaScript', runnable: 'script' },
  jsx: { id: 'javascript', label: 'JavaScript (JSX)', runnable: 'script' },
  ts: { id: 'typescript', label: 'TypeScript', runnable: 'script' },
  mts: { id: 'typescript', label: 'TypeScript', runnable: 'script' },
  tsx: { id: 'typescript', label: 'TypeScript (TSX)', runnable: 'script' },
  json: { id: 'json', label: 'JSON', runnable: 'none' },
  md: { id: 'markdown', label: 'Markdown', runnable: 'none' },
  markdown: { id: 'markdown', label: 'Markdown', runnable: 'none' },
  svg: { id: 'xml', label: 'SVG', runnable: 'none' },
  xml: { id: 'xml', label: 'XML', runnable: 'none' },
  yaml: { id: 'yaml', label: 'YAML', runnable: 'none' },
  yml: { id: 'yaml', label: 'YAML', runnable: 'none' },
  sh: { id: 'shell', label: 'Shell', runnable: 'none' },
  py: { id: 'python', label: 'Python', runnable: 'none' },
  rs: { id: 'rust', label: 'Rust', runnable: 'none' },
  go: { id: 'go', label: 'Go', runnable: 'none' },
  java: { id: 'java', label: 'Java', runnable: 'none' },
  c: { id: 'c', label: 'C', runnable: 'none' },
  h: { id: 'c', label: 'C', runnable: 'none' },
  cpp: { id: 'cpp', label: 'C++', runnable: 'none' },
  cc: { id: 'cpp', label: 'C++', runnable: 'none' },
  txt: PLAIN,
};

/** A Map: a file called "x.constructor" must not resolve to an inherited Object property. */
const BY_EXTENSION: ReadonlyMap<string, LanguageInfo> = new Map(Object.entries(EXTENSIONS));

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function languageForPath(path: string): LanguageInfo {
  return BY_EXTENSION.get(extensionOf(path)) ?? PLAIN;
}

export function isScriptSource(path: string): boolean {
  return languageForPath(path).runnable === 'script';
}

/** Every language NexusIDE can edit, for the "supported languages" surface in the UI and docs. */
export function listLanguages(): readonly LanguageInfo[] {
  const seen = new Map<string, LanguageInfo>();
  for (const info of BY_EXTENSION.values()) {
    if (!seen.has(info.id)) seen.set(info.id, info);
  }
  return [...seen.values()];
}
