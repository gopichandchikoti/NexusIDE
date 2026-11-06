import JSZip from 'jszip';
import { expect, shot, watchErrors } from '../lib.mjs';
import {
  chipText,
  consoleText,
  importZip,
  makeZip,
  openApp,
  openFileFromTree,
  seedWorkspace,
  waitForChip,
  waitForConsole,
  waitForEditor,
  waitForSandboxText,
} from '../app.mjs';

const tree = page => page.getByRole('tree', { name: 'Workspace files' });
const names = async page => (await tree(page).getByRole('treeitem').allTextContents()).map(t => t.trim());
const startTemplate = (page, name) => page.locator('.template', { hasText: name }).click();

export async function run({ fresh, report }) {
  await report.check(
    'E-01',
    'First run',
    'Start screen with 4 templates, no console errors, correct title',
    async () => {
      const context = await fresh();
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto('http://localhost:4173');
      await page.waitForSelector('h1');
      expect((await page.title()) === 'NexusIDE', 'title');
      expect((await page.locator('.template').count()) === 4, 'template count');
      await page.waitForTimeout(500);
      expect(errors.length === 0, `console errors: ${errors.join(' | ')}`);
      await shot(page, '01-welcome');
      await context.close();
      return '4 templates, 0 console errors';
    }
  );

  await report.check(
    'E-02',
    'Run',
    'Web template: Run shows the page in the sandbox and console output arrives',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await startTemplate(page, 'Web page');
      await waitForEditor(page);
      await page.keyboard.press('Control+Enter');
      await waitForSandboxText(page, '#clock', '1:15');
      const frame = page.frames().find(f => /sandbox\.html(\?|$)/.test(f.url()));
      await frame.getByRole('button', { name: /Oolong/ }).click();
      await waitForConsole(page, 'Selected Oolong');
      await waitForSandboxText(page, '#clock', '2:30');
      expect((await chipText(page)).includes('Running'), `chip: ${await chipText(page)}`);
      await shot(page, '02-web-template-running');
      await context.close();
      return 'page rendered in sandbox; click -> console.log relayed; DOM updated';
    }
  );

  await report.check('E-03', 'Persistence', 'Edits autosave and survive a reload (open tabs restored)', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await seedWorkspace(page, { 'note.txt': 'first line' });
    await openFileFromTree(page, 'note.txt');
    await waitForEditor(page);
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' persisted-e2e');
    await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Saved'), null, {
      timeout: 15000,
    });
    await page.reload();
    await page.waitForSelector('.boot', { state: 'detached' });
    await waitForEditor(page);
    // Monaco renders spaces as non-breaking spaces.
    const text = (await page.locator('.monaco-editor .view-lines').innerText()).replace(/ /g, ' ');
    expect(text.includes('first line persisted-e2e'), `editor text after reload: ${JSON.stringify(text)}`);
    expect((await page.getByRole('tab', { name: /note.txt/ }).count()) === 1, 'tab restored');
    await context.close();
    return 'content + tab restored after reload';
  });

  await report.check('E-04', 'Diagnostics', 'TypeScript error appears in Problems and status bar', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await startTemplate(page, 'TypeScript console');
    await waitForEditor(page);
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nconst oops: string = 42;');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Problems' }).click();
    await page.waitForFunction(
      () => document.querySelector('.problems')?.textContent?.includes('not assignable'),
      null,
      { timeout: 30000 }
    );
    const status = await page.locator('.status__btn').innerText();
    expect(/[1-9]\d* errors/.test(status), `status: ${status}`);
    await shot(page, '04-problems');
    await page.locator('.problem').first().click();
    await context.close();
    return 'Monaco TS diagnostics surfaced: "not assignable"';
  });

  await report.check('E-05', 'Run', 'TypeScript console program runs in a Worker and finishes', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await startTemplate(page, 'TypeScript console');
    await waitForEditor(page);
    await page.keyboard.press('Control+Enter');
    await waitForConsole(page, 'Primes up to 50:');
    await waitForChip(page, 'Finished');
    const out = await consoleText(page);
    expect(out.includes('15 primes, largest 47'), `output: ${out.slice(0, 200)}`);
    expect(out.includes('Grouped by last digit: Map('), 'Map printed');
    await context.close();
    return '15 primes, largest 47; chip Finished';
  });

  await report.check(
    'E-06',
    'Files',
    'Create / validate / rename / folder / delete / undo through the UI',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      const toolbar = page.locator('.tree__toolbar');
      const dialog = page.getByRole('dialog');
      await toolbar.getByRole('button', { name: 'New file' }).click();
      await dialog.getByLabel('File name').fill('notes.md');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await page.getByRole('tab', { name: /notes.md/ }).waitFor();
      await toolbar.getByRole('button', { name: 'New file' }).click();
      await dialog.getByLabel('File name').fill('a/b');
      await dialog.getByRole('button', { name: 'Create' }).click();
      expect((await dialog.getByRole('alert').innerText()).includes('slashes'), 'slash error shown');
      await dialog.getByLabel('File name').fill('NOTES.md');
      await dialog.getByRole('button', { name: 'Create' }).click();
      expect((await dialog.getByRole('alert').innerText()).includes('already exists'), 'duplicate error shown');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await toolbar.getByRole('button', { name: 'Rename selected' }).click();
      await dialog.getByLabel('File name').fill('todo.md');
      await dialog.getByRole('button', { name: 'Rename' }).click();
      await page.getByRole('tab', { name: /todo.md/ }).waitFor();
      await toolbar.getByRole('button', { name: 'New folder' }).click();
      await dialog.getByLabel('Folder name').fill('src');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await toolbar.getByRole('button', { name: 'New file' }).click();
      await dialog.getByLabel('File name').fill('x.ts');
      await dialog.getByRole('button', { name: 'Create' }).click();
      const after = await names(page);
      expect(after.join(',') === 'src,x.ts,todo.md', `tree: ${after.join(',')}`);
      await openFileFromTree(page, 'todo.md');
      await toolbar.getByRole('button', { name: 'Delete selected' }).click();
      await dialog.getByRole('button', { name: 'Delete' }).click();
      await page.locator('.toast', { hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
      await page.getByRole('treeitem', { name: 'todo.md' }).waitFor();
      await shot(page, '06-files');
      await context.close();
      return 'validation errors shown; rename/folder/nesting OK; delete undone via toast';
    }
  );

  await report.check('E-07', 'Palette', 'Command palette, quick open and shortcuts', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await seedWorkspace(page, { 'alpha.ts': 'a', 'beta.ts': 'b' });
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill('theme paper');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
    await page.keyboard.press('Control+p');
    const quick = page.getByRole('dialog', { name: 'Go to file' });
    await quick.waitFor();
    await quick.getByRole('combobox').fill('bet');
    await page.keyboard.press('Enter');
    await page.getByRole('tab', { name: /beta.ts/ }).waitFor();
    await page.keyboard.press('F1');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'detached' });
    await page.keyboard.press('Alt+p');
    await page.waitForSelector('.preview', { state: 'detached' });
    await context.close();
    return 'Ctrl+Shift+P, Ctrl+P, F1, Esc, Alt+P all work; theme switched via palette';
  });

  await report.check('E-08', 'Search', 'Search across files, click result reveals the line', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await seedWorkspace(page, { 'a.txt': 'x\nx\nNEEDLE here', 'dir/b.txt': 'needle again', 'c.txt': 'nothing' });
    await page.keyboard.press('Control+Shift+F');
    await page.getByLabel('Search in all files').fill('needle');
    await page.waitForFunction(() =>
      document.querySelector('.search__status')?.textContent?.includes('2 results in 2 files')
    );
    await page.locator('.hit').first().click();
    await page.getByRole('tab', { name: /a.txt/ }).waitFor();
    await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Ln 3'), null, {
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Use regular expression' }).click();
    await page.getByLabel('Search in all files').fill('(');
    await page.waitForFunction(() => document.querySelector('.search__status')?.textContent?.includes('not valid'));
    await page.getByLabel('Search in all files').fill('a*');
    await page.waitForFunction(() => !document.querySelector('.search__status')?.textContent?.includes('not valid'));
    await context.close();
    return '2 results in 2 files; reveal -> Ln 3; invalid regex reported; a* terminates';
  });

  await report.check('E-09', 'ZIP', 'Export ZIP then import into a clean browser profile (roundtrip)', async () => {
    const source = await fresh();
    const page = await openApp(source);
    const files = {
      'index.html': '<h1>hi</h1>',
      'src/app.js': 'console.log(1)',
      'src/lib/util.js': 'export const u = 1;',
      'README.md': '# r',
    };
    await seedWorkspace(page, files);
    const download = page.waitForEvent('download');
    await page.locator('.tree__toolbar').getByRole('button', { name: 'Export workspace as ZIP' }).click();
    const file = await download;
    expect(/^nexuside-\d{8}-\d{4}\.zip$/.test(file.suggestedFilename()), `filename ${file.suggestedFilename()}`);
    const { readFileSync } = await import('node:fs');
    // Read once: Playwright deletes the download artifact when its context closes.
    const bytes = readFileSync(await file.path());
    const zip = await JSZip.loadAsync(bytes);
    const exported = Object.keys(zip.files)
      .filter(n => !zip.files[n].dir)
      .sort();
    expect(exported.join(',') === 'README.md,index.html,src/app.js,src/lib/util.js', `zip entries: ${exported}`);
    await source.close();

    const target = await fresh();
    const second = await openApp(target);
    await importZip(second, 'roundtrip.zip', bytes);
    await second.getByRole('treeitem', { name: 'util.js' }).waitFor();
    const got = await names(second);
    expect(got.join(',') === 'src,lib,util.js,app.js,index.html,README.md', `imported tree: ${got}`);
    await target.close();
    return `4 files exported (${file.suggestedFilename()}) and re-imported with folder structure`;
  });

  await report.check('E-10', 'Errors', 'Running an unsupported language explains why (no fake success)', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await seedWorkspace(page, { 'main.py': 'print(1)' });
    await openFileFromTree(page, 'main.py');
    await waitForEditor(page);
    await page.keyboard.press('Control+Enter');
    const toast = await page.locator('.toast').first().innerText();
    expect(toast.includes("Python files can't run"), `toast: ${toast}`);
    await context.close();
    return toast.replace(/\s+/g, ' ');
  });

  await report.check(
    'E-11',
    'Backups',
    'Template over existing work asks first, backs up, and the backup restores',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await seedWorkspace(page, { 'precious.txt': 'do not lose' });
      await page.keyboard.press('Control+Shift+P');
      await page.getByRole('combobox').fill('start from a template');
      await page.keyboard.press('Enter');
      await page
        .getByRole('dialog', { name: 'Start from a template' })
        .locator('.template', { hasText: 'Blank' })
        .click();
      await page.getByRole('button', { name: 'Replace with template' }).click();
      await page.getByRole('treeitem', { name: 'README.md' }).waitFor();
      expect((await page.getByRole('treeitem', { name: 'precious.txt' }).count()) === 0, 'old file replaced');
      await page.getByRole('button', { name: 'Settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.getByText('Before starting').waitFor();
      await settings.getByRole('button', { name: 'Restore' }).first().click();
      await page.getByRole('treeitem', { name: 'precious.txt' }).waitFor();
      await context.close();
      return 'confirm -> backup created -> restore brought precious.txt back';
    }
  );

  await report.check(
    'E-12',
    'Run',
    'React 18.3.1 template renders and responds to clicks (vendored, offline)',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await startTemplate(page, 'React 18');
      await waitForEditor(page);
      await page.keyboard.press('Control+Enter');
      await waitForSandboxText(page, 'h1', 'Tally');
      const frame = page.frames().find(f => /sandbox\.html(\?|$)/.test(f.url()));
      await frame.getByRole('button', { name: 'Increase Coffees' }).click();
      await frame.getByRole('button', { name: 'Increase Coffees' }).click();
      await waitForSandboxText(page, '.total', 'Total: 2');
      await shot(page, '12-react-template');
      await context.close();
      return 'JSX/TSX bundled in the browser; hooks work; Total: 2 after two clicks';
    }
  );

  await report.check(
    'E-13',
    'Terminal',
    'JavaScript REPL in the sandbox: evaluate, keep state, report errors',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await page.keyboard.press('Control+`');
      const term = page.locator('.repl');
      await term.waitFor();
      await term.click();
      const send = async text => {
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
      };
      await send('6*7');
      await page.waitForFunction(() => document.querySelector('.repl')?.textContent?.includes('=> 42'), null, {
        timeout: 15000,
      });
      await send('var kept = 7');
      await send('kept * 2');
      await page.waitForFunction(() => document.querySelector('.repl')?.textContent?.includes('=> 14'), null, {
        timeout: 10000,
      });
      await send('nope.x');
      await page.waitForFunction(() => document.querySelector('.repl')?.textContent?.includes('ReferenceError'), null, {
        timeout: 10000,
      });
      await send('fetch("https://example.com").then(() => "ALLOWED", e => "blocked: " + e.name)');
      await page.waitForFunction(() => document.querySelector('.repl')?.textContent?.includes('blocked:'), null, {
        timeout: 10000,
      });
      await shot(page, '13-terminal-repl');
      await context.close();
      return '6*7 => 42; state kept across lines; ReferenceError reported; fetch blocked in REPL';
    }
  );

  await report.check('E-14', 'Layout', 'Layout choices persist across reload (dock, hidden panes)', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await page.keyboard.press('Control+Shift+P');
    await page.getByRole('combobox').fill('dock below');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+b');
    await page.waitForSelector('.sidebar', { state: 'detached' });
    await page.reload();
    await page.waitForSelector('.boot', { state: 'detached' });
    expect((await page.locator('.sidebar').count()) === 0, 'sidebar stays hidden after reload');
    const layout = await page.evaluate(() => JSON.parse(localStorage.getItem('nexuside.layout.v1')));
    expect(layout.previewDock === 'bottom' && layout.showSidebar === false, JSON.stringify(layout));
    await context.close();
    return JSON.stringify(layout);
  });

  await report.check('E-15', 'Import', 'Project with TSX + JSON + CSS imports bundles and runs', async () => {
    const context = await fresh();
    const page = await openApp(context);
    const zip = await makeZip({
      'index.html': '<div id="out"></div><script type="module" src="/main.ts"></script>',
      'main.ts':
        "import data from './data.json'; import { greet } from './lib/greet'; import './style.css';\ndocument.getElementById('out')!.textContent = greet(data.name);\nconsole.log('loaded', data.items.length);",
      'lib/greet.ts': 'export const greet = (n: string): string => `Hello, ${n}!`;',
      'data.json': '{"name":"Ada","items":[1,2,3]}',
      'style.css': '#out{color:rgb(1,2,3)}',
    });
    await seedWorkspace(page, {});
    await importZip(page, 'proj.zip', zip);
    await page.getByRole('treeitem', { name: 'main.ts' }).waitFor();
    await openFileFromTree(page, 'index.html');
    await page.keyboard.press('Control+Enter');
    await waitForSandboxText(page, '#out', 'Hello, Ada!');
    await waitForConsole(page, 'loaded 3');
    await context.close();
    return 'TS module graph + JSON + CSS resolved offline; "Hello, Ada!" rendered';
  });
}
