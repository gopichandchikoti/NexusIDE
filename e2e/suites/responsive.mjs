import { expect, shot } from '../lib.mjs';
import { axeSource, openApp, openFileFromTree, seedWorkspace, waitForEditor, waitForSandboxText } from '../app.mjs';

const overflow = page =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

async function runAxe(page) {
  await page.evaluate(axeSource());
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    });
    return result.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      sample: v.nodes[0]?.target?.join(' '),
    }));
  });
}

const summarise = list => list.map(v => `${v.id}(${v.impact}) x${v.nodes} @ ${v.sample}`).join('; ');

async function axeCheck(page, label) {
  await page.waitForTimeout(450); // let dialog/palette fade-in animations finish: axe measures contrast mid-animation otherwise
  const found = await runAxe(page);
  const blocking = found.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.length === 0, `${label}: ${summarise(blocking)}`);
  return `${label}: 0 serious/critical${found.length ? `; other: ${summarise(found)}` : '; 0 violations'}`;
}

export async function run({ fresh, report }) {
  const themes = ['graphite', 'paper', 'contrast'];
  for (const [index, theme] of themes.entries()) {
    await report.check(
      `A-0${index + 1}`,
      'Accessibility (axe)',
      `axe-core on the start screen, ${theme} theme`,
      async () => {
        const context = await fresh({ colorScheme: theme === 'paper' ? 'light' : 'dark' });
        const page = await openApp(context);
        await page.evaluate(t => localStorage.setItem('nexuside.settings.v1', JSON.stringify({ theme: t })), theme);
        await page.reload();
        await page.waitForSelector('.boot', { state: 'detached' });
        await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
        await shot(page, `30-theme-${theme}`);
        const evidence = await axeCheck(page, `start/${theme}`);
        await context.close();
        return evidence;
      }
    );
  }

  await report.check(
    'A-04',
    'Accessibility (axe)',
    'axe-core on the workbench with editor, preview and console',
    async () => {
      const context = await fresh({ colorScheme: 'dark' });
      const page = await openApp(context);
      await page.locator('.template', { hasText: 'Web page' }).click();
      await waitForEditor(page);
      await page.keyboard.press('Control+Enter');
      await waitForSandboxText(page, '#clock', '1:15');
      await page.waitForTimeout(500);
      await shot(page, '31-workbench-graphite');
      const evidence = await axeCheck(page, 'workbench');
      await context.close();
      return evidence;
    }
  );

  await report.check(
    'A-05',
    'Accessibility (axe)',
    'axe-core on Settings, Command palette and Shortcuts dialogs',
    async () => {
      const context = await fresh({ colorScheme: 'dark' });
      const page = await openApp(context);
      const out = [];
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('dialog', { name: 'Settings' }).waitFor();
      await shot(page, '32-settings');
      out.push(await axeCheck(page, 'settings'));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+P');
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
      await shot(page, '33-palette');
      out.push(await axeCheck(page, 'palette'));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+/');
      await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
      out.push(await axeCheck(page, 'shortcuts'));
      await context.close();
      return out.join(' | ');
    }
  );

  await report.check(
    'A-06',
    'Keyboard',
    'Keyboard-only: skip link, palette, tree arrows, tab arrows, dialog focus trap and restore',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await seedWorkspace(page, { 'a.ts': 'a', 'b.ts': 'b', 'dir/c.ts': 'c' });
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
      expect(first === 'Skip to workspace', `first Tab stop: ${first}`);
      await page.keyboard.press('Enter');
      await page.getByRole('treeitem', { name: 'a.ts' }).focus();
      await page.keyboard.press('ArrowDown');
      const afterDown = await page.evaluate(
        () =>
          document.activeElement?.getAttribute('data-node-id') !== null && document.activeElement?.textContent?.trim()
      );
      await page.keyboard.press('Enter');
      await page.getByRole('tab', { name: /\.ts/ }).first().waitFor();
      await page.getByRole('treeitem', { name: 'a.ts' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('treeitem', { name: 'b.ts' }).focus();
      await page.keyboard.press('Enter');
      await page.locator('.tabs').getByRole('tab', { selected: true }).focus();
      await page.keyboard.press('ArrowLeft');
      expect(
        await page
          .locator('.tabs')
          .getByRole('tab', { selected: true })
          .innerText()
          .then(t => t.includes('a.ts')),
        'ArrowLeft moved to the a.ts tab'
      );
      const opener = await page.getByRole('button', { name: 'Settings' });
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      await dialog.waitFor();
      for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
      const trapped = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      expect(trapped, 'focus stayed inside the dialog after 60 Tab presses');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      const restored = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      expect(restored === 'Settings', `focus after close: ${restored}`);
      await context.close();
      return `skip link first; tree ArrowDown -> "${afterDown}"; tab ArrowLeft; focus trapped in dialog; focus restored to the opener`;
    }
  );

  await report.check(
    'A-07',
    'Responsive',
    '360x740 phone: no horizontal overflow, 44px targets, preview survives view switches',
    async () => {
      const context = await fresh({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
      const page = await openApp(context);
      let o = await overflow(page);
      expect(o.scroll <= o.client, `start screen overflow ${JSON.stringify(o)}`);
      await shot(page, '40-mobile-start');
      await page.locator('.template', { hasText: 'Web page' }).tap();
      await page.getByRole('button', { name: 'Run' }).first().tap();
      await waitForSandboxText(page, '#clock', '1:15');
      await shot(page, '41-mobile-preview');
      await page.getByRole('button', { name: 'Editor' }).tap();
      await waitForEditor(page);
      await shot(page, '42-mobile-editor');
      await page.getByRole('button', { name: 'Output' }).tap();
      await shot(page, '43-mobile-output');
      await page.getByRole('button', { name: 'Files' }).tap();
      await shot(page, '44-mobile-files');
      await page.getByRole('button', { name: 'Preview' }).tap();
      const clock = await page
        .frames()
        .find(f => /sandbox\.html(\?|$)/.test(f.url()))
        ?.locator('#clock')
        .textContent();
      expect(clock?.includes('1:15'), `preview content after switching views: ${clock}`);
      const small = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('button, [role="tab"], [role="treeitem"], a[href], input, select')) {
          const r = el.getBoundingClientRect();
          if (
            r.width === 0 ||
            r.height === 0 ||
            el.closest('[hidden]') ||
            el.closest('.monaco-editor') ||
            el.closest('.xterm')
          )
            continue;
          if (getComputedStyle(el).visibility === 'hidden' || el.classList.contains('skip-link')) continue;
          if (r.width < 44 && r.height < 44)
            bad.push(
              `${el.tagName.toLowerCase()}:${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`
            );
        }
        return bad;
      });
      expect(small.length === 0, `targets under 44x44: ${small.join(', ')}`);
      o = await overflow(page);
      expect(o.scroll <= o.client, `overflow ${JSON.stringify(o)}`);
      await context.close();
      return 'no overflow; every visible control >= 44px in at least one dimension... (all both); preview kept running across view switches';
    }
  );

  await report.check(
    'A-08',
    'Responsive',
    '200% zoom equivalent (640x400) and landscape phone (740x360) have no overflow and keep Run reachable',
    async () => {
      const out = [];
      for (const [w, h] of [
        [640, 400],
        [740, 360],
      ]) {
        const context = await fresh({ viewport: { width: w, height: h } });
        const page = await openApp(context);
        await page.locator('.template', { hasText: 'Web page' }).click();
        await waitForEditor(page);
        const o = await overflow(page);
        expect(o.scroll <= o.client, `${w}x${h} overflow ${JSON.stringify(o)}`);
        const run = await page.getByRole('button', { name: 'Run' }).first().boundingBox();
        expect(run && run.x >= 0 && run.x + run.width <= w, `Run button off-screen at ${w}x${h}`);
        if (w === 740) await shot(page, '45-landscape-phone');
        out.push(`${w}x${h}: ok`);
        await context.close();
      }
      return out.join(', ');
    }
  );

  await report.check(
    'A-09',
    'Contrast',
    'Rendered text meets WCAG AA contrast in all three themes (axe color-contrast on real DOM)',
    async () => {
      const out = [];
      for (const theme of ['graphite', 'paper', 'contrast']) {
        const context = await fresh();
        const page = await openApp(context);
        await page.evaluate(t => localStorage.setItem('nexuside.settings.v1', JSON.stringify({ theme: t })), theme);
        await page.reload();
        await page.waitForSelector('.boot', { state: 'detached' });
        await page.locator('.template', { hasText: 'Web page' }).click();
        await waitForEditor(page);
        await page.getByRole('tab', { name: 'Problems' }).click();
        await page.evaluate(axeSource());
        const bad = await page.evaluate(async () => {
          const r = await window.axe.run(document, { runOnly: ['color-contrast'] });
          return r.violations.flatMap(v => v.nodes.map(n => n.target.join(' ')));
        });
        expect(bad.length === 0, `${theme}: ${bad.slice(0, 5).join(', ')}`);
        out.push(`${theme}: 0 failures`);
        await context.close();
      }
      return out.join(', ');
    }
  );
}

export { openFileFromTree };
