// Runs the browser test suites against the production build served by `vite preview`, using the installed Microsoft Edge.
// Usage: pnpm run build && pnpm run e2e [core|security|resilience|responsive ...]
import { join } from 'node:path';
import { Report, ROOT, launchEdge, startPreview } from './lib.mjs';

const SUITES = ['core', 'security', 'resilience', 'responsive'];
const wanted = process.argv.slice(2).filter(a => SUITES.includes(a));
const selected = wanted.length ? wanted : SUITES;

const server = await startPreview();
const browser = await launchEdge();
const report = new Report(
  `Edge ${browser.version()} (headless, Playwright ${(await import('playwright-core/package.json', { with: { type: 'json' } })).default.version})`
);

/** Every check gets its own incognito-like context: empty IndexedDB and localStorage. */
const fresh = async (options = {}) => {
  const { initScript, ...rest } = options;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...rest });
  if (initScript) await context.addInitScript(initScript);
  return context;
};

let exitCode = 0;
try {
  for (const name of selected) {
    console.log(`\n== ${name} ==`);
    const suite = await import(`./suites/${name}.mjs`);
    await suite.run({ fresh, report });
  }
} catch (error) {
  console.error(error);
  exitCode = 2;
} finally {
  // A renderer stuck in a hostile loop can make a graceful close block; give it 10 s, then move on.
  await Promise.race([browser.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 10_000))]);
  server.kill();
}

const failed = report.failed;
const suffix = selected.length === SUITES.length ? '' : `-${selected.join('-')}`;
report.save(join(ROOT, 'docs', `e2e-results${suffix}.json`));
console.log(`\n${report.rows.length - failed.length}/${report.rows.length} checks passed on ${report.browserVersion}`);
failed.forEach(f => console.log(`FAILED ${f.id} ${f.name}\n   ${f.evidence}`));
process.exit(exitCode || (failed.length ? 1 : 0));
