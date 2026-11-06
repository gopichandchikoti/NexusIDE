// One command to get a fresh clone working: checks the toolchain, installs from the lockfile, optionally verifies.
//   node scripts/bootstrap.mjs            install dependencies
//   node scripts/bootstrap.mjs --verify   install, then run the full local gate (format, types, lint, tests, build)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const [required] = String(pkg.engines?.node ?? '>=20.19.0').match(/\d+\.\d+\.\d+/) ?? ['20.19.0'];

const parse = v => v.split('.').map(Number);
const [maj, min, pat] = parse(process.versions.node);
const [rMaj, rMin, rPat] = parse(required);
if (maj < rMaj || (maj === rMaj && (min < rMin || (min === rMin && pat < rPat)))) {
  console.error(`Node ${required} or newer is required (found ${process.versions.node}).`);
  process.exit(1);
}

const run = (command, args) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`\nFailed: ${command} ${args.join(' ')} (exit ${result.status}). Blocked command above.`);
    process.exit(result.status ?? 1);
  }
};

const pnpm = spawnSync('pnpm', ['--version'], { shell: process.platform === 'win32', encoding: 'utf8' });
if (pnpm.status !== 0) {
  console.error('pnpm is required: `npm install -g pnpm` (or `corepack enable`), then rerun.');
  process.exit(1);
}
console.log(`Node ${process.versions.node}, pnpm ${pnpm.stdout.trim()}`);

run('pnpm', ['install', '--frozen-lockfile']);
if (process.argv.includes('--verify')) run('pnpm', ['run', 'ci']);

console.log(`
Done. Next steps:
  pnpm dev                 start the dev server (http://localhost:5173)
  pnpm run build           production build into dist/
  pnpm preview             serve dist/ at http://localhost:4173 (use this to judge security headers and offline mode)
  pnpm run e2e             browser tests (needs Microsoft Edge; set E2E_CHANNEL=chromium to use Playwright's Chromium)
`);
