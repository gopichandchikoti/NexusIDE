// @vitest-environment jsdom
// jsdom keeps DOMParser documents inert (like browsers); happy-dom tries to load their <script>/<link> resources.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/limits';
import { bridgeSource, type BridgeMode } from './bridgeSource';
import { bundleModules, normalizePath, resolveFrom } from './bundler';
import { SANDBOX_CSP } from './csp';
import { buildPreviewDocument, escapeInline } from './documentBuilder';
import { parseSandboxEvent } from './protocol';
import { REACT_EXTERNALS, RUNTIME_VERSIONS } from './vendor';

type Posted = Record<string, unknown>;

/** Runs code in a VM that looks like a Worker global (no `window`). */
function runAsWorker(code: string, globals: Record<string, unknown> = {}) {
  const posted: Posted[] = [];
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const ctx: Record<string, unknown> = {
    postMessage: (m: Posted) => posted.push(m),
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] ??= []).push(fn),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: {},
    ...globals,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, posted, listeners };
}

const worker = (mode: BridgeMode, body: string, globals?: Record<string, unknown>) =>
  runAsWorker(`${bridgeSource(mode)}${body}`, globals);

const logs = (posted: Posted[]) => posted.filter(m => m.type === 'console').map(m => m.text);
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('paths', () => {
  it('normalizes and resolves relative to the importer, refusing to escape the root', () => {
    expect(normalizePath('a/./b/../c')).toBe('a/c');
    expect(normalizePath('../x')).toBeNull();
    expect(resolveFrom('src/app/main.ts', './util')).toBe('src/app/util');
    expect(resolveFrom('src/app/main.ts', '../lib/x.ts?raw')).toBe('src/lib/x.ts');
    expect(resolveFrom('src/main.ts', '/other/y.js')).toBe('other/y.js');
    expect(resolveFrom('main.ts', '../../outside')).toBeNull();
  });
});

describe('bridge in a Worker', () => {
  it('formats console arguments like a developer console', () => {
    const circular: Record<string, unknown> = { n: 1 };
    circular.self = circular;
    const { posted } = worker(
      'script',
      `console.log('a', 1, [1,'x'], {k: undefined}, null, new Map([[1,2]]), function foo(){}, 10n);
       console.warn('w'); console.error(new Error('boom').message); console.log(${'JSON.stringify'}(1));`,
      { circular }
    );
    expect(logs(posted)[0]).toBe('a 1 [1, "x"] {k: undefined} null Map(1) [[1, 2]] [Function: foo] 10n');
    expect(posted.filter(m => m.level === 'warn')).toHaveLength(1);
    expect(posted.every(m => m.source === 'nexus-sandbox')).toBe(true);
  });

  it('prints circular structures without recursing forever', () => {
    const { posted } = worker('script', 'var o={a:1}; o.o=o; console.log(o);');
    expect(logs(posted)).toEqual(['{a: 1, o: [Circular]}']);
  });

  it('reports uncaught errors and unhandled rejections and suppresses the default handler', () => {
    const { listeners, posted } = worker('script', '');
    let prevented = 0;
    listeners.error?.[0]?.({ message: 'kaboom', preventDefault: () => prevented++ });
    listeners.unhandledrejection?.[0]?.({ reason: 'nope', preventDefault: () => prevented++ });
    expect(posted.map(m => m.message)).toEqual(['kaboom', 'Unhandled promise rejection: nope']);
    expect(prevented).toBe(2);
  });

  it('signals done only once timers have drained', async () => {
    const { ctx, posted } = worker(
      'script',
      `setTimeout(function(){ console.log('t1'); }, 5);
       var n=0; var id=setInterval(function(){ n++; console.log('i'+n); if(n===2) clearInterval(id); }, 5);
       self.__nexusFinish();`
    );
    expect(posted.some(m => m.type === 'done')).toBe(false);
    await tick(80);
    expect(logs(posted).sort()).toEqual(['i1', 'i2', 't1']);
    expect(posted.filter(m => m.type === 'done')).toHaveLength(1);
    expect(typeof ctx.__nexusFinish).toBe('function');
  });

  it('is done immediately for a synchronous program', async () => {
    const { posted } = worker('script', `console.log('hi'); self.__nexusFinish();`);
    await tick(10);
    expect(posted.map(m => m.type)).toEqual(['console', 'done']);
  });

  it('evaluates REPL input, awaiting promises and reporting errors', async () => {
    const { ctx, posted } = worker('repl', '');
    const send = (id: number, code: string) => (ctx.onmessage as (e: unknown) => void)({ data: { id, code } });
    send(1, '1 + 2');
    send(2, '"a" + "b"');
    send(3, 'Promise.resolve([1,2])');
    send(4, 'nope.x');
    send(5, 'var kept = 7; kept');
    send(6, 'kept * 2');
    await tick(10);
    const results = posted.filter(m => m.type === 'repl-result');
    expect(results.map(r => [r.id, r.ok, r.text])).toEqual([
      [1, true, '3'],
      [2, true, '"ab"'],
      [4, false, expect.stringContaining('ReferenceError')],
      [5, true, '7'],
      [6, true, '14'],
      [3, true, '[1, 2]'],
    ]);
  });
});

describe('bundleModules', () => {
  const run = async (files: Record<string, string>, entry: string, externals: readonly string[] = []) => {
    const bundle = await bundleModules(files, entry, { externals });
    if (!bundle.ok) return { bundle };
    const w = worker('script', bundle.value.code);
    return { bundle, posted: w.posted };
  };

  it('resolves relative imports, extensions, index files, json, and TypeScript syntax', async () => {
    const { posted, bundle } = await run(
      {
        'main.ts': `import { add } from './lib/math';
import cfg from './cfg.json';
import * as utils from './utils';
interface P { n: number }
const p: P = { n: add(1, 2) };
console.log(p.n, cfg.name, utils.twice(4), utils.default);`,
        'lib/math.ts': 'export const add = (a: number, b: number): number => a + b;',
        'cfg.json': '{"name":"cfg"}',
        'utils/index.ts': 'export const twice = (n: number) => n * 2; export default "dflt";',
      },
      'main.ts'
    );
    expect(bundle.ok).toBe(true);
    expect(logs(posted ?? [])).toEqual(['3 cfg 8 dflt']);
  });

  it('supports circular imports without recursing forever', async () => {
    const { posted } = await run(
      {
        'a.js': `import { b } from './b.js'; export const a = 'A'; console.log('a sees', b);`,
        'b.js': `import * as A from './a.js'; export const b = 'B'; console.log('b sees', typeof A.a);`,
      },
      'a.js'
    );
    expect(logs(posted ?? [])).toEqual(['b sees undefined', 'a sees B']);
  });

  it('maps .js specifiers to .ts sources (TypeScript convention)', async () => {
    const { posted } = await run(
      { 'm.ts': `import { x } from './n.js'; console.log(x);`, 'n.ts': 'export const x = 9;' },
      'm.ts'
    );
    expect(logs(posted ?? [])).toEqual(['9']);
  });

  it('collects css imports instead of executing them', async () => {
    const bundle = await bundleModules(
      { 'a.js': `import './s.css'; console.log(1);`, 's.css': 'a{color:red}' },
      'a.js',
      {
        externals: [],
      }
    );
    expect(bundle.ok && bundle.value.css).toEqual(['a{color:red}']);
  });

  it('fails with structured errors for missing files, bad syntax, bad JSON and unsupported packages', async () => {
    const missing = await bundleModules({ 'a.ts': `import './nope';` }, 'a.ts', { externals: [] });
    expect(!missing.ok && missing.error).toMatchObject({
      code: 'BUILD_FAILED',
      message: expect.stringContaining('nope'),
    });
    const syntax = await bundleModules({ 'a.ts': 'const = ;' }, 'a.ts', { externals: [] });
    expect(!syntax.ok && syntax.error.message).toContain('a.ts');
    const json = await bundleModules({ 'a.js': `import x from './d.json';`, 'd.json': '{bad' }, 'a.js', {
      externals: [],
    });
    expect(!json.ok && json.error.message).toContain('invalid JSON');
    const pkg = await bundleModules({ 'a.js': `import _ from 'lodash';` }, 'a.js', { externals: ['react'] });
    expect(!pkg.ok && pkg.error).toMatchObject({
      code: 'UNSUPPORTED_DEPENDENCY',
      message: expect.stringContaining('react'),
    });
    const noEntry = await bundleModules({}, 'x.ts', { externals: [] });
    expect(!noEntry.ok && noEntry.error.code).toBe('NO_ENTRY');
    const text = await bundleModules({ 'a.js': `import './x.md';`, 'x.md': '#' }, 'a.js', { externals: [] });
    expect(!text.ok && text.error.message).toContain('.md');
  });

  it('wires declared externals and reports them as used', async () => {
    const files = { 'a.tsx': `import { createElement } from 'react'; console.log(typeof createElement, <b />);` };
    const bundle = await bundleModules(files, 'a.tsx', { externals: REACT_EXTERNALS });
    expect(bundle.ok && [...bundle.value.usedExternals].sort()).toEqual(['react', 'react/jsx-runtime']);
    if (!bundle.ok) return;
    const externals = {
      react: { createElement: () => 1 },
      'react/jsx-runtime': { jsx: () => 'JSX', jsxs: () => 'JSX' },
    };
    const w = runAsWorker(`${bridgeSource('script')}var __NEXUS_EXTERNALS__=this.ext;${bundle.value.code}`, {
      ext: externals,
    });
    expect(logs(w.posted)).toEqual(['function JSX']);
  });

  it('throws a helpful runtime error when an external is not provided (Worker)', async () => {
    const bundle = await bundleModules({ 'a.js': `import 'react';` }, 'a.js', { externals: ['react'] });
    if (!bundle.ok) throw new Error('bundle');
    expect(() => runAsWorker(bundle.value.code)).toThrow(/only available in page previews/);
  });
});

describe('buildPreviewDocument', () => {
  const page = (body: string, head = '') => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

  it('inlines local css and classic scripts verbatim, in order', async () => {
    const r = await buildPreviewDocument(
      {
        'index.html': page('<script src="app.js"></script>', '<link rel="stylesheet" href="css/s.css">'),
        'css/s.css': 'body{margin:0}',
        'app.js': 'function hello(){ return 1 }',
      },
      'index.html'
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.html).toContain('<style>body{margin:0}</style>');
    expect(r.value.html).toContain('function hello(){ return 1 }');
    expect(r.value.html).not.toContain('src="app.js"');
    expect(r.value.notices).toEqual([]);
  });

  it('places the CSP and bridge before any user content', async () => {
    const r = await buildPreviewDocument({ 'index.html': page('<p>x</p>', '<title>t</title>') }, 'index.html');
    if (!r.ok) throw new Error('build');
    const { html } = r.value;
    const meta = html.indexOf('Content-Security-Policy');
    expect(meta).toBeGreaterThan(-1);
    expect(html.indexOf('__send')).toBeGreaterThan(meta);
    expect(html.indexOf('<title>')).toBeGreaterThan(html.indexOf('__send'));
    expect(html).toContain(SANDBOX_CSP);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('removes external resources with a notice instead of loading them', async () => {
    const r = await buildPreviewDocument(
      {
        'index.html': page(
          '<script src="https://cdn.example.com/lib.js"></script><script src="//evil.example/x.js"></script><script src="missing.js"></script>',
          '<link rel="stylesheet" href="https://fonts.example/css"><link rel="stylesheet" href="gone.css">'
        ),
      },
      'index.html'
    );
    if (!r.ok) throw new Error('build');
    expect(r.value.html).not.toContain('cdn.example.com');
    expect(r.value.html).not.toContain('evil.example');
    expect(r.value.notices).toHaveLength(5);
    expect(r.value.notices.join('\n')).toContain('no network access');
  });

  it('bundles module and TypeScript scripts, deferred until the DOM is ready', async () => {
    const r = await buildPreviewDocument(
      {
        'index.html': page('<div id="o"></div><script type="module" src="/src/main.ts"></script>'),
        'src/main.ts': `import { msg } from './msg'; document.getElementById('o')!.textContent = msg;`,
        'src/msg.ts': `export const msg: string = 'hi';`,
      },
      'index.html'
    );
    if (!r.ok) throw new Error('build');
    expect(r.value.html).toContain('DOMContentLoaded');
    expect(r.value.html).toContain('"src/msg.ts"');
    expect(r.value.html).not.toContain('type="module"');
    expect(r.value.html).not.toContain('react.production');
  });

  it('bundles inline module scripts', async () => {
    const r = await buildPreviewDocument(
      {
        'index.html': page(`<script type="module">import {a} from './a.js'; console.log(a)</script>`),
        'a.js': 'export const a = 1',
      },
      'index.html'
    );
    expect(r.ok && r.value.html).toContain('"a.js"');
  });

  it('adds the vendored React runtime only when the bundle uses it', async () => {
    const r = await buildPreviewDocument(
      {
        'index.html': page('<div id="root"></div><script type="module" src="main.tsx"></script>'),
        'main.tsx': `import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')!).render(<h1>x</h1>);`,
      },
      'index.html'
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.html).toContain('__NEXUS_EXTERNALS__');
    expect(r.value.html).toMatch(/ReactDOM/);
    expect(RUNTIME_VERSIONS.react).toMatch(/^18\./);
  });

  it('keeps hostile text from closing its own script element', async () => {
    const r = await buildPreviewDocument(
      {
        'index.html': page('<script src="a.js"></script>'),
        'a.js': `var s = "</script><img src=x onerror=alert(1)>"; var c = "<!-- x";`,
      },
      'index.html'
    );
    if (!r.ok) throw new Error('build');
    expect(r.value.html).not.toContain('</script><img');
    const reparsed = new DOMParser().parseFromString(r.value.html, 'text/html');
    expect(reparsed.querySelectorAll('img')).toHaveLength(0);
    expect(escapeInline('</STYLE>', 'style')).toBe('<\\/STYLE>');
  });

  it('treats Object.prototype names as missing files, never as content (no crash)', async () => {
    const r = await buildPreviewDocument(
      {
        'index.html': page(
          '<script src="constructor"></script><script src="toString"></script>',
          '<link rel="stylesheet" href="valueOf">'
        ),
      },
      'index.html'
    );
    expect(r.ok && r.value.notices).toHaveLength(3);
    const entry = await buildPreviewDocument({}, 'constructor');
    expect(!entry.ok && entry.error.code).toBe('NO_ENTRY');
    const bundle = await bundleModules({ 'main.ts': `import './constructor';` }, 'main.ts', { externals: [] });
    expect(!bundle.ok && bundle.error.code).toBe('BUILD_FAILED');
    const pkg = await bundleModules({ 'main.ts': `import 'constructor';` }, 'main.ts', { externals: [] });
    expect(!pkg.ok && pkg.error.code).toBe('UNSUPPORTED_DEPENDENCY');
  });

  it('surfaces bundle errors and a missing entry', async () => {
    const bad = await buildPreviewDocument(
      { 'index.html': page('<script type="module" src="m.ts"></script>'), 'm.ts': 'import "lodash";' },
      'index.html'
    );
    expect(!bad.ok && bad.error.code).toBe('UNSUPPORTED_DEPENDENCY');
    const none = await buildPreviewDocument({}, 'index.html');
    expect(!none.ok && none.error.code).toBe('NO_ENTRY');
  });
});

describe('parseSandboxEvent', () => {
  const m = (extra: Record<string, unknown>) => ({ source: 'nexus-sandbox', ...extra });

  it('accepts well-formed events', () => {
    expect(parseSandboxEvent(m({ type: 'ready' }))).toEqual({ type: 'ready' });
    expect(parseSandboxEvent(m({ type: 'alive' }))).toEqual({ type: 'alive' });
    expect(parseSandboxEvent(m({ type: 'console', level: 'warn', text: 'x' }))).toEqual({
      type: 'console',
      level: 'warn',
      text: 'x',
    });
    expect(parseSandboxEvent(m({ type: 'repl-result', id: 3, ok: true, text: '1' }))).toMatchObject({ id: 3 });
  });

  it.each([
    null,
    undefined,
    'str',
    42,
    [],
    {},
    { type: 'ready' },
    m({ type: 'unknown' }),
    m({ type: 'console', level: 'fatal', text: 'x' }),
    m({ type: 'console', level: 'log', text: 5 }),
    m({ type: 'error', message: {} }),
    m({ type: 'repl-result', id: 1.5, ok: true, text: '' }),
    m({ type: 'repl-result', id: 1, ok: 'yes', text: '' }),
    m({ type: 'constructor' }),
    m({ type: '__proto__' }),
    m({ type: 'toString' }),
    m({ type: 'hasOwnProperty' }),
    m({ type: 7 }),
  ])('rejects %j', data => {
    expect(parseSandboxEvent(data)).toBeNull();
  });

  it('truncates oversize text so a flood cannot exhaust memory', () => {
    const e = parseSandboxEvent(m({ type: 'console', level: 'log', text: 'x'.repeat(LIMITS.maxConsoleChars * 5) }));
    expect(e && e.type === 'console' && e.text.length).toBeLessThan(LIMITS.maxConsoleChars + 20);
  });
});
