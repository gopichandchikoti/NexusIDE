import { describe, expect, it } from 'vitest';
import { buildServiceWorker, isPrecached } from './precache';

describe('service worker generation', () => {
  it('excludes the worker itself, host headers, source maps and manifests', () => {
    expect(isPrecached('index.html')).toBe(true);
    expect(isPrecached('assets/MonacoView-abc.js')).toBe(true);
    expect(isPrecached('sandbox.html')).toBe(true);
    for (const skipped of ['sw.js', '_headers', 'assets/x.js.map', '.vite/manifest.json']) {
      expect(isPrecached(skipped)).toBe(false);
    }
  });

  it('embeds the version and a relative, normalised file list in front of the template', () => {
    const sw = buildServiceWorker('v123', ['index.html', 'assets\\a.js', 'sw.js', 'x.map'], '// TEMPLATE BODY');
    expect(sw).toContain('const VERSION = "v123";');
    expect(sw).toContain('"./index.html"');
    expect(sw).toContain('"./assets/a.js"');
    expect(sw).not.toContain('sw.js"');
    expect(sw).not.toContain('x.map');
    expect(sw.endsWith('// TEMPLATE BODY')).toBe(true);
    const list = JSON.parse(/const FILES = (\[[\s\S]*?\]);/.exec(sw)?.[1] ?? '[]') as string[];
    expect(list).toEqual(['./index.html', './assets/a.js']);
  });
});
