// Helpers that drive the real NexusIDE UI (and seed its IndexedDB) from Playwright.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { ORIGIN, expect } from './lib.mjs';

const require = createRequire(import.meta.url);

export async function openApp(context, options = {}) {
  const page = await context.newPage();
  if (options.initScript) await page.addInitScript(options.initScript);
  await page.goto(ORIGIN);
  await page.waitForSelector('.app', { timeout: 20_000 });
  await page.waitForSelector('.boot', { state: 'detached', timeout: 20_000 });
  return page;
}

/** Writes a workspace straight into IndexedDB (schema v1), then reloads so the app boots from it. */
export async function seedWorkspace(page, files) {
  await page.evaluate(
    ({ files }) =>
      new Promise((resolve, reject) => {
        const nodes = [];
        const folders = new Map();
        const now = Date.now();
        const folder = parts => {
          let parent = null;
          for (let i = 0; i < parts.length; i++) {
            const key = parts.slice(0, i + 1).join('/');
            if (!folders.has(key)) {
              const id = crypto.randomUUID();
              folders.set(key, id);
              nodes.push({
                id,
                parentId: parent,
                name: parts[i],
                kind: 'folder',
                content: '',
                createdAt: now,
                updatedAt: now,
              });
            }
            parent = folders.get(key);
          }
          return parent;
        };
        for (const [path, content] of Object.entries(files)) {
          const parts = path.split('/');
          const parentId = folder(parts.slice(0, -1));
          nodes.push({
            id: crypto.randomUUID(),
            parentId,
            name: parts[parts.length - 1],
            kind: 'file',
            content,
            createdAt: now,
            updatedAt: now,
          });
        }
        const open = indexedDB.open('nexuside', 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          db.createObjectStore('nodes', { keyPath: 'id' });
          db.createObjectStore('drafts', { keyPath: 'fileId' });
          db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('nodes', 'readwrite');
          tx.objectStore('nodes').clear();
          nodes.forEach(n => tx.objectStore('nodes').put(n));
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { files }
  );
  await page.reload();
  await page.waitForSelector('.boot', { state: 'detached', timeout: 20_000 });
}

export async function readDb(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('nexuside', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['nodes', 'drafts'], 'readonly');
          const nodes = tx.objectStore('nodes').getAll();
          const drafts = tx.objectStore('drafts').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve({ nodes: nodes.result, drafts: drafts.result });
          };
        };
      })
  );
}

export function makeZip(files) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function importZip(page, name, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import ZIP' }).first().click();
  await (await chooser).setFiles({ name, mimeType: 'application/zip', buffer });
  const confirm = page.getByRole('button', { name: 'Replace with ZIP' });
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
}

export function sandboxFrame(page) {
  return page.frames().find(f => /sandbox\.html(\?|$)/.test(f.url())) ?? null;
}

export async function waitForSandboxText(page, selector, text, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last = 'no sandbox frame';
  while (Date.now() < deadline) {
    const frame = sandboxFrame(page);
    if (frame) {
      last = await frame
        .locator(selector)
        .first()
        .textContent({ timeout: 500 })
        .catch(() => 'selector not found');
      if (last?.includes(text)) return last;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`sandbox ${selector} never contained "${text}" (last: ${JSON.stringify(last)})`);
}

export async function consoleText(page) {
  return (await page.locator('.console__line pre').allTextContents()).join('\n');
}

export async function waitForConsole(page, text, timeout = 15_000) {
  await page.waitForFunction(
    needle => Array.from(document.querySelectorAll('.console__line pre')).some(p => p.textContent?.includes(needle)),
    text,
    { timeout }
  );
}

export async function openFileFromTree(page, name) {
  await page.getByRole('treeitem', { name }).first().click();
}

export async function waitForEditor(page) {
  await page.waitForSelector('.monaco-editor .view-lines', { timeout: 30_000 });
}

export async function chipText(page) {
  return (await page.locator('.panel__head .chip').first().textContent())?.trim() ?? '';
}

export async function waitForChip(page, text, timeout = 15_000) {
  await page.waitForFunction(
    needle => document.querySelector('.panel__head .chip')?.textContent?.includes(needle),
    text,
    { timeout }
  );
}

/** axe-core source text. It is injected over CDP (page.evaluate), because the app's strict CSP blocks inline <script>. */
export function axeSource() {
  return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
}

export { expect };
