/** Files that must not be precached: the service worker itself, host config, source maps. */
const EXCLUDED = [/^sw\.js$/, /^_headers$/, /\.map$/, /^\.vite\//, /^precache-manifest\.json$/];

export function isPrecached(path: string): boolean {
  return !EXCLUDED.some(rx => rx.test(path));
}

/** Produces the service worker for one build: the template plus that build's version and exact file list. */
export function buildServiceWorker(version: string, files: readonly string[], template: string): string {
  const list = files.filter(isPrecached).map(f => `./${f.replace(/\\/g, '/')}`);
  return `/* Generated at build time. Do not edit. */\nconst VERSION = ${JSON.stringify(version)};\nconst FILES = ${JSON.stringify(list, null, 1)};\n${template}`;
}
