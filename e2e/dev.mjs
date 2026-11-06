// Exercises the development lifecycle, including upgrading a tab whose preview registration is already broken.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { launchEdge, ROOT } from './lib.mjs';

const ORIGIN = 'http://localhost:5184';
const PANE = resolve(ROOT, 'src/components/preview/PreviewPane.tsx').replaceAll('\\', '/');
let legacy = true;

// Reproduce the old cleanup in memory. The user's source files and workspace are never replaced.
function legacyPreview() {
  return {
    name: 'nexuside-legacy-preview-fixture',
    enforce: 'pre',
    transform(code, id) {
      if (!legacy || id.split('?')[0] !== PANE) return;
      assert.ok(code.includes('    mounts.preview = element;'), 'preview fixture setup changed');
      return code
        .replace('    mounts.preview = element;', '')
        .replace('if (mounts.preview === element) mounts.preview = null;', 'mounts.preview = null;');
    },
  };
}

const server = await createServer({
  root: ROOT,
  configFile: resolve(ROOT, 'vite.config.ts'),
  cacheDir: resolve(ROOT, 'node_modules/.vite-e2e-dev'),
  server: { port: 5184, strictPort: true, open: false },
  plugins: [legacyPreview()],
});
await server.listen();
let browser;

async function fresh(compact = false) {
  const context = await browser.newContext({
    viewport: compact ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.goto(ORIGIN);
  await page.waitForSelector('.template');
  return { context, page, errors };
}

async function startTemplate(page, template) {
  await page.locator('.template', { hasText: template }).click();
  await page.waitForSelector('.monaco-editor .view-lines');
}

const startRun = page => page.getByRole('button', { name: 'Run', exact: true }).first().click();
const frame = page => page.frameLocator('iframe[title="Preview of your project (sandboxed)"]');
const total = (page, value) => frame(page).getByText(`Total: ${value}`, { exact: true }).waitFor();

async function checkHotReload() {
  const { context, page, errors } = await fresh();
  try {
    await startTemplate(page, 'React');
    await startRun(page);
    await page.getByText('The preview could not start', { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Preview' }).getByText('Open the preview pane to run a page.').waitFor();
    await page.locator('.preview__mount').evaluate(node => node.setAttribute('data-preserved', 'true'));

    legacy = false;
    const module = server.moduleGraph.getModuleById(PANE);
    assert.ok(module, 'preview module loaded');
    await server.reloadModule(module);
    await page.waitForFunction(async () => {
      const { mounts } = await import('/src/app/services.ts');
      return mounts.preview?.isConnected;
    });
    assert.equal(await page.locator('.preview__mount').getAttribute('data-preserved'), 'true');

    await startRun(page);
    await total(page, 0);
    await frame(page).getByRole('button', { name: 'Increase Coffees' }).click();
    await total(page, 1);
    assert.deepEqual(errors, []);
    console.log('PASS hot reload: broken open tab recovers without remounting the pane or reloading the page');
  } finally {
    await context.close();
  }
}

async function checkTemplate(template, compact) {
  const { context, page, errors } = await fresh(compact);
  try {
    await startTemplate(page, template);
    await startRun(page);
    if (template === 'TypeScript console') {
      await page.getByText('15 primes, largest 47', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.panel__head .chip')?.textContent.includes('Finished'));
    } else {
      const selector = template === 'React' ? '.total' : '#clock';
      await frame(page).locator(selector).waitFor();
      await page.getByRole('button', { name: 'Run again' }).click();
      await frame(page).locator(selector).waitFor();
      if (compact) {
        await page.getByRole('button', { name: 'Editor', exact: true }).click();
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Close preview' }).click();
        await page.waitForSelector('.preview', { state: 'detached' });
        await startRun(page);
      }
      await frame(page).locator(selector).waitFor();
    }
    await page.reload();
    await page.waitForSelector('.monaco-editor .view-lines');
    await startRun(page);
    if (template === 'TypeScript console') await page.getByText('15 primes, largest 47', { exact: true }).waitFor();
    else
      await frame(page)
        .locator(template === 'React' ? '.total' : '#clock')
        .waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${compact ? 'mobile' : 'desktop'} ${template}: run, rerun/layout, persisted workspace reload`);
  } finally {
    await context.close();
  }
}

async function checkTerminal() {
  const { context, page, errors } = await fresh();
  try {
    await startTemplate(page, 'TypeScript console');
    await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
    const send = async () => {
      await page.locator('.repl').click();
      await page.keyboard.type('console.log("terminal-marker-" + (6 * 7))');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.repl')?.textContent.includes('terminal-marker-42'));
    };
    await send();
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.keyboard.press('Control+`');
    await send();
    assert.deepEqual(errors, []);
    console.log('PASS terminal: console output reaches the live terminal after StrictMode and panel reopen');
  } finally {
    await context.close();
  }
}

try {
  browser = await launchEdge();
  const terminalOnly = process.argv.includes('terminal');
  if (!terminalOnly) {
    await checkHotReload();
    for (const compact of [false, true]) {
      for (const template of ['Web page', 'TypeScript console', 'React']) await checkTemplate(template, compact);
    }
  }
  await checkTerminal();
  console.log(`${terminalOnly ? '1/1' : '8/8'} development lifecycle checks passed`);
} finally {
  await browser?.close();
  await server.close();
}
