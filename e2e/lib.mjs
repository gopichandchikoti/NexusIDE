// Shared helpers for the browser (Edge) test run: server, browser, evidence collection.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = 4173;
export const ORIGIN = `http://localhost:${PORT}`;
export const SHOTS = join(ROOT, 'docs', 'screenshots');

export async function startPreview() {
  const child = spawn(
    process.execPath,
    [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ORIGIN);
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  child.kill();
  throw new Error('vite preview did not start (is dist/ built? run pnpm run build)');
}

/**
 * A real TCP listener that stands in for "the attacker's server". Hostile code is pointed at it; any connection,
 * HTTP request or WebSocket upgrade is recorded. Because it is a real socket (not a browser-level mock), a zero
 * count proves nothing left the sandbox for this address.
 */
export async function startCanary() {
  const seen = { connections: 0, requests: [], upgrades: 0, connectionTimes: [] };
  const server = createServer((req, res) => {
    seen.requests.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'access-control-allow-origin': '*' }).end('canary');
  });
  server.on('connection', () => {
    seen.connections += 1;
    seen.connectionTimes.push(Date.now());
  });
  server.on('upgrade', (_req, socket) => {
    seen.upgrades += 1;
    socket.destroy();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { seen, url: `http://localhost:${port}`, close: () => server.close() };
}

/** Microsoft Edge by default (what the recorded results use). E2E_CHANNEL=chromium uses Playwright's own Chromium (CI). */
export const BROWSER_CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
export const launchOptions =
  BROWSER_CHANNEL === 'chromium' ? { headless: true } : { channel: BROWSER_CHANNEL, headless: true };

export async function launchEdge() {
  return chromium.launch(launchOptions);
}

/** Records results as { id, area, name, result, evidence } so they can be written into docs/TEST_REPORT.md. */
export class Report {
  rows = [];
  constructor(browserVersion) {
    this.browserVersion = browserVersion;
  }
  async check(id, area, name, fn) {
    const started = Date.now();
    try {
      const evidence = await fn();
      this.rows.push({ id, area, name, result: 'PASS', evidence: String(evidence ?? ''), ms: Date.now() - started });
      console.log(`  PASS ${id} ${name}`);
    } catch (error) {
      const full = error instanceof Error ? error.message : String(error);
      const message = full.replace(/\s*\n\s*/g, ' | ').slice(0, 900);
      this.rows.push({ id, area, name, result: 'FAIL', evidence: message, ms: Date.now() - started });
      console.log(`  FAIL ${id} ${name}\n       ${message}`);
    }
  }
  get failed() {
    return this.rows.filter(r => r.result === 'FAIL');
  }
  save(path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ browser: this.browserVersion, at: new Date().toISOString(), rows: this.rows }, null, 2)
    );
  }
}

export function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Collects console errors and page errors so a test can assert the app was clean. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

export async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}
