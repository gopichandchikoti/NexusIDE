import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { ORIGIN, expect, launchOptions } from '../lib.mjs';
import { openApp, openFileFromTree, seedWorkspace, waitForEditor, waitForSandboxText } from '../app.mjs';

const toast = (page, text) => page.locator('.toast', { hasText: text }).first();

export async function run({ fresh, report }) {
  await report.check(
    'R-01',
    'Recovery',
    'Renderer crash with unsaved edits: edits are offered back on next launch',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'nexuside-profile-'));
      const context = await chromium.launchPersistentContext(dir, {
        ...launchOptions,
        viewport: { width: 1280, height: 800 },
      });
      try {
        const page = await openApp(context);
        await seedWorkspace(page, { 'doc.txt': 'saved text' });
        await page.evaluate(() => localStorage.setItem('nexuside.settings.v1', JSON.stringify({ autoSave: false })));
        await page.reload();
        await page.waitForSelector('.boot', { state: 'detached' });
        await openFileFromTree(page, 'doc.txt');
        await waitForEditor(page);
        await page.locator('.monaco-editor .view-lines').click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type(' UNSAVED-BEFORE-CRASH');
        await page.waitForFunction(
          () => document.querySelector('.status')?.textContent?.includes('Unsaved changes'),
          null,
          { timeout: 10000 }
        );
        await page.waitForTimeout(900);
        const cdp = await context.newCDPSession(page);
        const crashed = new Promise(resolve => page.once('crash', () => resolve(true)));
        cdp.send('Page.crash').catch(() => {}); // never settles: the target renderer dies
        const didCrash = await Promise.race([crashed, new Promise(r => setTimeout(() => r(false), 5000))]);
        await Promise.race([
          page.close({ runBeforeUnload: false }).catch(() => {}),
          new Promise(r => setTimeout(r, 5000)),
        ]);

        const reopened = await context.newPage();
        await reopened.goto(ORIGIN);
        await reopened.waitForSelector('.banner--recover', { timeout: 20000 });
        const banner = await reopened.locator('.banner--recover').innerText();
        expect(banner.includes('Recovered unsaved edits'), banner);
        await reopened.getByRole('button', { name: 'Restore' }).click();
        await openFileFromTree(reopened, 'doc.txt');
        await waitForEditor(reopened);
        const text = (await reopened.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' ');
        expect(text.includes('saved text UNSAVED-BEFORE-CRASH'), `restored text: ${JSON.stringify(text)}`);
        return `${didCrash ? 'renderer crash event observed' : 'tab closed abruptly (crash event not observed)'}; banner shown; Restore recovered the typed text`;
      } finally {
        await Promise.race([context.close().catch(() => {}), new Promise(r => setTimeout(r, 8000))]);
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  await report.check('R-02', 'Recovery', 'Discarding recovered edits keeps the saved text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexuside-profile-'));
    const context = await chromium.launchPersistentContext(dir, launchOptions);
    try {
      const page = await openApp(context);
      await seedWorkspace(page, { 'doc.txt': 'saved text' });
      await page.evaluate(() => localStorage.setItem('nexuside.settings.v1', JSON.stringify({ autoSave: false })));
      await page.reload();
      await page.waitForSelector('.boot', { state: 'detached' });
      await openFileFromTree(page, 'doc.txt');
      await waitForEditor(page);
      await page.locator('.monaco-editor .view-lines').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' DISCARD-ME');
      await page.waitForTimeout(900);
      await page.close({ runBeforeUnload: false });
      const next = await context.newPage();
      await next.goto(ORIGIN);
      await next.waitForSelector('.banner--recover', { timeout: 20000 });
      await next.getByRole('button', { name: 'Discard' }).click();
      await next.waitForSelector('.banner--recover', { state: 'detached' });
      await next.reload();
      await next.waitForSelector('.boot', { state: 'detached' });
      expect((await next.locator('.banner--recover').count()) === 0, 'banner does not return');
      await waitForEditor(next);
      const text = (await next.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' ');
      expect(text.includes('saved text') && !text.includes('DISCARD-ME'), `text: ${JSON.stringify(text)}`);
      return 'banner gone after Discard and after reload; saved text intact';
    } finally {
      await Promise.race([context.close().catch(() => {}), new Promise(r => setTimeout(r, 8000))]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await report.check(
    'R-03',
    'Corrupt data',
    'Damaged records in IndexedDB are skipped and reported; the app still works',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await seedWorkspace(page, { 'good.txt': 'ok' });
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('nexuside', 1);
            open.onsuccess = () => {
              const tx = open.result.transaction('nodes', 'readwrite');
              tx.objectStore('nodes').put({ id: 'bad1', name: 12345, kind: 'file' });
              tx.objectStore('nodes').put({
                id: 'bad2',
                parentId: 'ghost',
                name: 'orphan.txt',
                kind: 'file',
                content: 'kept',
                createdAt: 'x',
              });
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            };
          })
      );
      await page.reload();
      await page.waitForSelector('.boot', { state: 'detached' });
      await toast(page, 'damaged').waitFor();
      const text = await toast(page, 'damaged').innerText();
      await page.getByRole('treeitem', { name: 'good.txt' }).waitFor();
      await page.getByRole('treeitem', { name: 'orphan.txt' }).waitFor();
      await context.close();
      return text.replace(/\s+/g, ' ');
    }
  );

  await report.check(
    'R-04',
    'Quota',
    'Storage quota error surfaces in the UI and recovers when space returns',
    async () => {
      const quota = () => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (window.__failPut) throw new DOMException('simulated', 'QuotaExceededError');
          return put.apply(this, args);
        };
      };
      const context = await fresh({ initScript: quota });
      const page = await openApp(context, { initScript: quota });
      await seedWorkspace(page, { 'a.txt': 'one' });
      await openFileFromTree(page, 'a.txt');
      await waitForEditor(page);
      await page.evaluate(() => (window.__failPut = true));
      await page.locator('.monaco-editor .view-lines').click();
      await page.keyboard.type('X');
      await toast(page, 'storage is full').waitFor({ timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Save failed'));
      await page.evaluate(() => (window.__failPut = false));
      await page.keyboard.type('Y');
      await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Saved'), null, {
        timeout: 15000,
      });
      await context.close();
      return 'toast "Browser storage is full"; status "Save failed"; status returns to "Saved" after space is available';
    }
  );

  await report.check(
    'R-05',
    'Storage unavailable',
    'IndexedDB blocked (private mode): banner, session editing still works',
    async () => {
      const block = () => {
        indexedDB.open = () => {
          throw new DOMException('blocked', 'SecurityError');
        };
      };
      const context = await fresh({ initScript: block });
      const page = await openApp(context, { initScript: block });
      await page.locator('.banner--warn').waitFor();
      expect((await page.locator('.banner--warn').innerText()).includes('storage is unavailable'), 'banner text');
      await page.locator('.template', { hasText: 'TypeScript console' }).click();
      await waitForEditor(page);
      await page.keyboard.press('Control+Enter');
      await page.waitForFunction(
        () => document.querySelector('.console')?.textContent?.includes('Primes up to 50'),
        null,
        { timeout: 15000 }
      );
      await page.keyboard.press('Control+s');
      await toast(page, 'nothing can be saved').waitFor();
      expect((await page.locator('.status').innerText()).includes('Not saved'), 'status bar says not saved');
      await context.close();
      return 'banner + status "Not saved"; template, editor and Run work in session-only mode; Ctrl+S explains why it cannot save';
    }
  );

  await report.check(
    'R-06',
    'Offline',
    'Editor chunk fails to load: error surface with retry, then recovery',
    async () => {
      const context = await fresh({ serviceWorkers: 'block' });
      const page = await openApp(context);
      await page.route('**/assets/MonacoView-*.js', route => route.abort());
      await page.locator('.template', { hasText: 'Web page' }).click();
      await page.getByRole('alert').filter({ hasText: 'could not be loaded' }).waitFor({ timeout: 15000 });
      await page.unroute('**/assets/MonacoView-*.js');
      await page.getByRole('button', { name: 'Reload page' }).click();
      await page.waitForSelector('.boot', { state: 'detached' });
      await waitForEditor(page);
      await context.close();
      return '"The editor could not be loaded" + Try again / Reload page; editor loads after reconnect';
    }
  );

  await report.check(
    'R-07',
    'Offline',
    'After load, going offline does not break editing, running or the REPL',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller)
          await new Promise(r =>
            navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true })
          );
      });
      await page.waitForFunction(() => document.documentElement.dataset.sandboxWarm === 'true', null, {
        timeout: 15000,
      });
      await page.locator('.template', { hasText: 'Web page' }).click();
      await waitForEditor(page);
      await context.setOffline(true);
      await page.keyboard.press('Control+Enter');
      await waitForSandboxText(page, '#clock', '1:15');
      // The terminal chunk was never loaded online: opening it now proves the service worker precache serves it.
      await page.keyboard.press('Control+`');
      await page.locator('.repl').waitFor();
      await page.locator('.repl').click();
      await page.keyboard.type('1+1');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.repl')?.textContent?.includes('=> 2'), null, {
        timeout: 15000,
      });
      // A full reload with no network must also start the app, restore the workspace and still run it.
      await page.reload();
      await page.waitForSelector('.boot', { state: 'detached' });
      await waitForEditor(page);
      await page.keyboard.press('Control+Enter');
      await waitForSandboxText(page, '#clock', '1:15');
      await context.setOffline(false);
      await context.close();
      return 'page preview + REPL worked with the network disabled; a reload while offline restored the workspace and ran it again';
    }
  );

  await report.check(
    'R-08',
    'Offline',
    'Terminal chunk missing while offline shows a retry surface (app stays alive)',
    async () => {
      const context = await fresh({ serviceWorkers: 'block' });
      const page = await openApp(context);
      await page.route('**/assets/TerminalView-*.js', route => route.abort());
      await page.keyboard.press('Control+`');
      await page.getByRole('alert').filter({ hasText: 'terminal could not be loaded' }).waitFor({ timeout: 15000 });
      expect((await page.locator('.app').count()) === 1, 'app still mounted');
      await page.unroute('**/assets/TerminalView-*.js');
      await context.close();
      return 'terminal failure is contained by ChunkBoundary';
    }
  );

  await report.check('R-09', 'Multi-tab', 'A second tab is told when another tab saved the workspace', async () => {
    const context = await fresh();
    const a = await openApp(context);
    await seedWorkspace(a, { 'shared.txt': 'one' });
    const b = await openApp(context);
    await openFileFromTree(a, 'shared.txt');
    await waitForEditor(a);
    await a.locator('.monaco-editor .view-lines').click();
    await a.keyboard.type('edit-from-tab-A');
    await toast(b, 'another NexusIDE tab').waitFor({ timeout: 15000 });
    await context.close();
    return 'BroadcastChannel notice appeared in tab B after tab A saved';
  });

  await report.check(
    'R-10',
    'Performance',
    'Large file (900 KB): opens, stays editable, keystroke latency measured',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      const line =
        'const value = computeSomething(argumentOne, argumentTwo) + 1; // filler text to make the line long\n';
      await seedWorkspace(page, { 'big.js': line.repeat(Math.floor(900_000 / line.length)) });
      const t0 = Date.now();
      await openFileFromTree(page, 'big.js');
      await waitForEditor(page);
      await page.waitForFunction(() =>
        document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('computeSomething')
      );
      const opened = Date.now() - t0;
      await page.locator('.monaco-editor .view-lines').click();
      await page.keyboard.press('Control+Home');
      const column = async () => Number(/Col (\d+)/.exec(await page.locator('.status').innerText())?.[1]);
      const times = [];
      for (let i = 0; i < 20; i++) {
        const expected = (await column()) + 1;
        const before = Date.now();
        await page.keyboard.type('k');
        await page.waitForFunction(
          n => Number(/Col (\d+)/.exec(document.querySelector('.status')?.textContent ?? '')?.[1]) === n,
          expected
        );
        times.push(Date.now() - before);
      }
      times.sort((x, y) => x - y);
      const p95 = times[Math.floor(times.length * 0.95) - 1] ?? times[times.length - 1];
      expect(opened < 8000, `opened in ${opened}ms`);
      expect(p95 < 500, `p95 keystroke ${p95}ms`);
      await context.close();
      return `opened in ${opened} ms; 20 keystrokes: median ${times[10]} ms, p95 ${p95} ms (Playwright round-trip included)`;
    }
  );

  await report.check(
    'R-11',
    'Accessibility',
    'prefers-reduced-motion and the Motion setting disable animations',
    async () => {
      const context = await fresh({ reducedMotion: 'reduce' });
      const page = await openApp(context);
      await page.getByRole('button', { name: 'Settings' }).click();
      const dur = await page.locator('.dialog').evaluate(el => getComputedStyle(el).animationDuration);
      expect(dur === '1e-05s', `OS reduce -> animation-duration ${dur}`);
      await context.close();
      const normal = await fresh({ reducedMotion: 'no-preference' });
      const p2 = await openApp(normal);
      await p2.getByRole('button', { name: 'Settings' }).click();
      const before = await p2.locator('.dialog').evaluate(el => getComputedStyle(el).animationDuration);
      await p2.getByLabel('Motion').selectOption('reduce');
      await p2.keyboard.press('Escape');
      await p2.getByRole('button', { name: 'Settings' }).click();
      const after = await p2.locator('.dialog').evaluate(el => getComputedStyle(el).animationDuration);
      expect(before === '0.2s' && after === '1e-05s', `setting: ${before} -> ${after}`);
      await normal.close();
      return `OS preference -> ${dur}; Motion setting: ${before} -> ${after}`;
    }
  );

  await report.check(
    'R-12',
    'Corrupt data',
    'Garbage in localStorage (settings, layout, session) falls back to defaults',
    async () => {
      const poison = () => {
        localStorage.setItem('nexuside.settings.v1', '{"theme":"neon","fontSize":"huge","tabSize":3');
        localStorage.setItem('nexuside.layout.v1', '[1,2,3]');
        localStorage.setItem('nexuside.session.v1', '{"tabs":[1,{"x":2}],"active":{}}');
      };
      const context = await fresh({ initScript: poison });
      const page = await openApp(context, { initScript: poison });
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      expect(['graphite', 'paper'].includes(theme), `theme ${theme}`);
      await page.locator('.template').first().waitFor();
      await context.close();
      return `app booted with defaults (resolved theme "${theme}")`;
    }
  );

  await report.check('R-13', 'Persistence', 'Autosave off: edits persist only after Ctrl+S', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await seedWorkspace(page, { 'm.txt': 'v1' });
    await page.evaluate(() => localStorage.setItem('nexuside.settings.v1', JSON.stringify({ autoSave: false })));
    await page.reload();
    await page.waitForSelector('.boot', { state: 'detached' });
    await openFileFromTree(page, 'm.txt');
    await waitForEditor(page);
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('-v2');
    await page.waitForTimeout(1800);
    const dirty = await page.locator('.status').innerText();
    expect(dirty.includes('Unsaved changes'), dirty);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Saved'), null, {
      timeout: 10000,
    });
    await context.close();
    return 'status "Unsaved changes (Ctrl+S)" for 1.8 s, then "Saved" after Ctrl+S';
  });

  await report.check(
    'R-14',
    'Formatting',
    'Format document works (Monaco formatter) via the command palette',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await seedWorkspace(page, { 'ugly.json': '{"a":1,"b":[1,2,3]}' });
      await openFileFromTree(page, 'ugly.json');
      await waitForEditor(page);
      await page.locator('.monaco-editor .view-lines').click();
      await page.keyboard.press('Alt+Shift+F');
      await page.waitForFunction(
        () =>
          (document.querySelector('.monaco-editor .view-lines')?.textContent ?? '').includes('"b"') &&
          document.querySelectorAll('.monaco-editor .view-line').length > 3,
        null,
        { timeout: 15000 }
      );
      await context.close();
      return 'one-line JSON expanded to multiple lines by Alt+Shift+F';
    }
  );
}
