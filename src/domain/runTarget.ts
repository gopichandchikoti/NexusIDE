import { fail, ok, type Result } from './errors';
import { extensionOf, languageForPath } from './languages';

export type RunTarget = { readonly mode: 'preview' | 'script'; readonly entry: string };

const ASSET_EXTENSIONS = new Set(['css', 'json', 'svg']);
const SCRIPT_ENTRY_CANDIDATES = [
  'src/main.tsx',
  'src/main.ts',
  'src/index.tsx',
  'src/index.ts',
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
];

function findIndexHtml(paths: readonly string[]): string | undefined {
  const html = paths.filter(p => languageForPath(p).runnable === 'preview');
  return (
    html.find(p => p === 'index.html') ?? html.find(p => !p.includes('/')) ?? html.find(p => p.endsWith('/index.html'))
  );
}

function unsupported(path: string): Result<RunTarget> {
  const label = languageForPath(path).label;
  return fail(
    'UNSUPPORTED_RUNTIME',
    `${label} files can't run in this browser sandbox. NexusIDE runs HTML, JavaScript, TypeScript and React projects.`
  );
}

/**
 * Decide what "Run" means. Scripts that belong to a page (an index.html exists) run as that page;
 * otherwise a JS/TS file runs as a console program.
 */
export function pickRunTarget(activePath: string | null, paths: readonly string[]): Result<RunTarget> {
  const indexHtml = findIndexHtml(paths);
  if (activePath !== null) {
    const kind = languageForPath(activePath).runnable;
    if (kind === 'preview') return ok({ mode: 'preview', entry: activePath });
    if (kind === 'script')
      return ok(indexHtml ? { mode: 'preview', entry: indexHtml } : { mode: 'script', entry: activePath });
    if (ASSET_EXTENSIONS.has(extensionOf(activePath)) && indexHtml) return ok({ mode: 'preview', entry: indexHtml });
    return unsupported(activePath);
  }
  if (indexHtml) return ok({ mode: 'preview', entry: indexHtml });
  const entry = SCRIPT_ENTRY_CANDIDATES.find(c => paths.includes(c));
  if (entry) return ok({ mode: 'script', entry });
  return fail('NO_ENTRY', 'Nothing to run yet. Add an index.html or a .js / .ts file.');
}
