import { fail, ok, type Result } from '@/domain/errors';
import { extensionOf } from '@/domain/languages';
import { bridgeSource } from './bridgeSource';
import { bundleModules, hasFile, resolveFrom, type SourceFiles } from './bundler';
import { SANDBOX_CSP } from './csp';
import { EXTERNALS_DEFINITION, REACT_EXTERNALS, loadReactVendor } from './vendor';

export interface PreviewBuild {
  readonly html: string;
  /** Non-fatal problems to show in the console, e.g. blocked external resources. */
  readonly notices: readonly string[];
}

const EXTERNAL_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const MODULE_EXTENSIONS = new Set(['ts', 'tsx', 'jsx', 'mts']);

/** Keeps inline code from closing its own <script>/<style> element or opening an HTML comment. */
export function escapeInline(text: string, tag: 'script' | 'style'): string {
  const close = new RegExp(`</${tag}`, 'gi');
  const escaped = text.replace(close, match => `<\\${match.slice(1)}`);
  return tag === 'script' ? escaped.replace(/<!--/g, '<\\!--') : escaped;
}

function runWhenReady(code: string): string {
  const wait = 'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",run);}else{run();}';
  return `(function(run){${wait}})(function(){\n${code}\n});`;
}

interface Context {
  readonly files: SourceFiles;
  readonly htmlPath: string;
  readonly doc: Document;
  readonly notices: string[];
  readonly css: string[];
  usesReact: boolean;
  inlineCounter: number;
}

async function bundleModuleScript(ctx: Context, files: SourceFiles, entry: string): Promise<Result<string>> {
  const bundle = await bundleModules(files, entry, { externals: REACT_EXTERNALS });
  if (!bundle.ok) return bundle;
  if (bundle.value.usedExternals.length > 0) ctx.usesReact = true;
  ctx.css.push(...bundle.value.css);
  return ok(runWhenReady(bundle.value.code));
}

function replaceScript(ctx: Context, node: Element, code: string): void {
  const script = ctx.doc.createElement('script');
  script.textContent = escapeInline(code, 'script');
  node.replaceWith(script);
}

async function processInlineModule(ctx: Context, node: Element): Promise<Result<void>> {
  const virtual = `__inline-${ctx.inlineCounter++}.mjs`;
  const built = await bundleModuleScript(ctx, { ...ctx.files, [virtual]: node.textContent ?? '' }, virtual);
  if (!built.ok) return built;
  replaceScript(ctx, node, built.value);
  return ok(undefined);
}

/** Resolves `src` to a project file, or removes the element and records why it could not be used. */
function resolveScriptTarget(ctx: Context, node: Element, src: string): string | null {
  if (EXTERNAL_URL.test(src)) {
    ctx.notices.push(
      `Blocked external script ${src}: the sandbox has no network access. Add the code to your project.`
    );
  } else {
    const target = resolveFrom(ctx.htmlPath, src);
    if (target !== null && hasFile(ctx.files, target)) return target;
    ctx.notices.push(`Script not found: ${src}`);
  }
  node.remove();
  return null;
}

async function processScript(ctx: Context, node: Element): Promise<Result<void>> {
  const src = node.getAttribute('src');
  const isModule = (node.getAttribute('type') ?? '').toLowerCase() === 'module';
  if (src === null) return isModule ? processInlineModule(ctx, node) : ok(undefined);
  const target = resolveScriptTarget(ctx, node, src);
  if (target === null) return ok(undefined);
  if (!isModule && !MODULE_EXTENSIONS.has(extensionOf(target))) {
    replaceScript(ctx, node, ctx.files[target] as string);
    return ok(undefined);
  }
  const built = await bundleModuleScript(ctx, ctx.files, target);
  if (!built.ok) return built;
  replaceScript(ctx, node, built.value);
  return ok(undefined);
}

function processStylesheet(ctx: Context, node: Element): void {
  const href = node.getAttribute('href') ?? '';
  if (EXTERNAL_URL.test(href)) {
    ctx.notices.push(`Blocked external stylesheet ${href}: the sandbox has no network access.`);
    node.remove();
    return;
  }
  const target = resolveFrom(ctx.htmlPath, href);
  if (target === null || !hasFile(ctx.files, target)) {
    ctx.notices.push(`Stylesheet not found: ${href}`);
    node.remove();
    return;
  }
  const style = ctx.doc.createElement('style');
  style.textContent = escapeInline(ctx.files[target] as string, 'style');
  node.replaceWith(style);
}

async function injectHead(ctx: Context): Promise<void> {
  const head = ctx.doc.head;
  const nodes: Element[] = [];
  const meta = ctx.doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', SANDBOX_CSP);
  nodes.push(meta);
  const bridge = ctx.doc.createElement('script');
  bridge.textContent = escapeInline(bridgeSource('document'), 'script');
  nodes.push(bridge);
  if (ctx.usesReact) {
    const vendor = await loadReactVendor();
    for (const text of [vendor.react, vendor.reactDom, EXTERNALS_DEFINITION]) {
      const s = ctx.doc.createElement('script');
      s.textContent = escapeInline(text, 'script');
      nodes.push(s);
    }
  }
  for (const css of ctx.css) {
    const style = ctx.doc.createElement('style');
    style.textContent = escapeInline(css, 'style');
    nodes.push(style);
  }
  head.prepend(...nodes);
}

/**
 * Turns an HTML file plus the project's files into one self-contained document for the sandbox iframe:
 * local CSS/JS are inlined, TS/JSX/module scripts are bundled, external URLs are removed with a notice.
 */
export async function buildPreviewDocument(files: SourceFiles, htmlPath: string): Promise<Result<PreviewBuild>> {
  if (!hasFile(files, htmlPath)) return fail('NO_ENTRY', `"${htmlPath}" does not exist.`);
  const doc = new DOMParser().parseFromString(files[htmlPath] as string, 'text/html');
  const ctx: Context = { files, htmlPath, doc, notices: [], css: [], usesReact: false, inlineCounter: 0 };
  doc.querySelectorAll('link[rel~="stylesheet"]').forEach(node => processStylesheet(ctx, node));
  for (const node of Array.from(doc.querySelectorAll('script'))) {
    const result = await processScript(ctx, node);
    if (!result.ok) return result;
  }
  await injectHead(ctx);
  return ok({ html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, notices: ctx.notices });
}
