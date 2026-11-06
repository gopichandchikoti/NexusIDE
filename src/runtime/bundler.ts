import type * as SucraseModule from 'sucrase';
import { fail, ok, type Result } from '@/domain/errors';
import { extensionOf } from '@/domain/languages';

export type SourceFiles = Readonly<Record<string, string>>;

/** Own-property check: "constructor" and "toString" are inherited names, not project files. */
export function hasFile(files: SourceFiles, path: string): boolean {
  return Object.hasOwn(files, path);
}

export interface BundleOptions {
  /** Bare specifiers that the host provides at runtime (e.g. react in page previews). */
  readonly externals: readonly string[];
}

export interface BundleOutput {
  /** Self-contained classic-script source. Executes the entry module immediately. */
  readonly code: string;
  readonly css: readonly string[];
  readonly usedExternals: readonly string[];
}

interface CompiledModule {
  readonly code: string;
  readonly deps: Record<string, string>;
}

const PROBE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css'];
const REQUIRE_RX = /\brequire\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;

/** Collapses ./ and ../ segments. Returns null if the path would climb above the project root. */
export function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.pop() === undefined) return null;
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** `/x` means project root (Vite convention); `./x` and `../x` are relative to the importer. */
export function resolveFrom(importer: string, spec: string): string | null {
  const cleaned = spec.split(/[?#]/)[0] as string;
  return normalizePath(cleaned.startsWith('/') ? cleaned : `${dirname(importer)}/${cleaned}`);
}

function probe(base: string, files: SourceFiles): string | null {
  const candidates = [base, ...PROBE_EXTENSIONS.map(e => base + e), ...PROBE_EXTENSIONS.map(e => `${base}/index${e}`)];
  if (/\.(m?js|jsx)$/.test(base)) {
    const stem = base.replace(/\.(m?js|jsx)$/, '');
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  return candidates.find(c => hasFile(files, c)) ?? null;
}

function isRelative(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || spec === '.' || spec === '..';
}

type Sucrase = typeof SucraseModule;

function transformsFor(path: string): Array<'typescript' | 'jsx' | 'imports'> | null {
  switch (extensionOf(path)) {
    case 'ts':
    case 'mts':
      return ['typescript', 'imports'];
    case 'tsx':
      return ['typescript', 'jsx', 'imports'];
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return ['jsx', 'imports'];
    default:
      return null;
  }
}

function compileModule(path: string, source: string, sucrase: Sucrase): Result<{ code: string; css?: string }> {
  const ext = extensionOf(path);
  if (ext === 'json') {
    try {
      JSON.parse(source);
    } catch {
      return fail('BUILD_FAILED', `${path}: invalid JSON.`);
    }
    return ok({ code: `module.exports = ${source};` });
  }
  if (ext === 'css') return ok({ code: '', css: source });
  const transforms = transformsFor(path);
  if (!transforms) return fail('BUILD_FAILED', `${path}: .${ext} files cannot be imported as modules.`);
  try {
    const { code } = sucrase.transform(source, {
      transforms,
      jsxRuntime: 'automatic',
      production: true,
      disableESTransforms: true,
      filePath: path,
    });
    return ok({ code });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'syntax error';
    return fail('BUILD_FAILED', `${path}: ${reason}`);
  }
}

function resolveDependency(importer: string, spec: string, files: SourceFiles, options: BundleOptions): Result<string> {
  if (!isRelative(spec)) {
    if (options.externals.includes(spec)) return ok(`ext:${spec}`);
    const hint = options.externals.length > 0 ? ` Available: ${options.externals.join(', ')}.` : '';
    return fail(
      'UNSUPPORTED_DEPENDENCY',
      `${importer}: cannot import "${spec}". npm packages are not available in the browser sandbox.${hint}`
    );
  }
  const base = resolveFrom(importer, spec);
  const found = base === null ? null : probe(base, files);
  return found === null ? fail('BUILD_FAILED', `${importer}: cannot find "${spec}".`) : ok(found);
}

function emit(entry: string, modules: Map<string, CompiledModule>): string {
  const defs = [...modules.entries()].map(
    ([path, m]) =>
      `${JSON.stringify(path)}:{d:${JSON.stringify(m.deps)},f:function(module,exports,require){\n${m.code}\n}}`
  );
  return [
    '(function(){',
    `var defs={${defs.join(',\n')}};`,
    'var cache={};',
    'var ext=typeof __NEXUS_EXTERNALS__==="undefined"?{}:__NEXUS_EXTERNALS__;',
    'function load(p){',
    '  if(cache[p])return cache[p].exports;',
    '  var def=defs[p],m={exports:{}};cache[p]=m;',
    '  def.f.call(m.exports,m,m.exports,function(s){',
    '    var t=Object.prototype.hasOwnProperty.call(def.d,s)?def.d[s]:undefined;',
    '    if(t===undefined)throw new Error("Cannot find module \\""+s+"\\"");',
    '    if(t.indexOf("ext:")===0){',
    '      var x=ext[t.slice(4)];',
    '      if(x===undefined)throw new Error("\\""+t.slice(4)+"\\" is only available in page previews.");',
    '      return x;',
    '    }',
    '    return load(t);',
    '  });',
    '  return m.exports;',
    '}',
    `load(${JSON.stringify(entry)});`,
    '})();',
  ].join('\n');
}

/** Transpiles `entry` and everything it imports into one classic script (no network, no npm). */
export async function bundleModules(
  files: SourceFiles,
  entry: string,
  options: BundleOptions
): Promise<Result<BundleOutput>> {
  if (!hasFile(files, entry)) return fail('NO_ENTRY', `Entry file "${entry}" does not exist.`);
  const sucrase = await import('sucrase');
  const modules = new Map<string, CompiledModule>();
  const css: string[] = [];
  const used = new Set<string>();
  const queue = [entry];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (modules.has(path)) continue;
    const compiled = compileModule(path, files[path] as string, sucrase);
    if (!compiled.ok) return compiled;
    if (compiled.value.css !== undefined) css.push(compiled.value.css);
    const deps: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const match of compiled.value.code.matchAll(REQUIRE_RX)) {
      const spec = match[2] as string;
      if (spec in deps) continue;
      const resolved = resolveDependency(path, spec, files, options);
      if (!resolved.ok) return resolved;
      deps[spec] = resolved.value;
      if (resolved.value.startsWith('ext:')) used.add(spec);
      else queue.push(resolved.value);
    }
    modules.set(path, { code: compiled.value.code, deps });
  }
  return ok({ code: emit(entry, modules), css, usedExternals: [...used] });
}
