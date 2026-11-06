// Checks the production build in dist/ and prints the artifact record used in docs/RELEASE.md.
// Run after `pnpm run build`. Exits 1 if any check fails.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
};

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!existsSync(dist)) {
  console.error('dist/ is missing. Run `pnpm run build` first.');
  process.exit(1);
}

const files = walk(dist).map(f => relative(dist, f).replace(/\\/g, '/'));
const text = name => readFileSync(join(dist, name), 'utf8');

for (const required of ['index.html', 'sandbox.html', 'sw.js', 'nexus-icon.svg', '_headers']) {
  check(files.includes(required), `${required} exists`);
}
check(
  files.some(f => /^assets\/index-.*\.js$/.test(f)),
  'application bundle exists'
);
check(
  files.some(f => /^assets\/MonacoView-.*\.js$/.test(f)),
  'editor chunk exists'
);
check(!files.some(f => f.endsWith('.map')), 'no source maps are shipped');
check(!files.some(f => /(^|\/)\.env/.test(f)), 'no .env file is shipped');

const index = text('index.html');
check(
  /http-equiv="Content-Security-Policy"/.test(index) && /script-src 'self'/.test(index),
  'index.html carries the app CSP (script-src self)'
);
check(!/<script(?![^>]*\bsrc=)[^>]*>/.test(index), 'index.html has no inline script');
check(
  !/unsafe-inline'?[^;]*script-src|script-src[^;]*unsafe-inline/.test(index),
  'app CSP does not allow inline scripts'
);

const sandbox = text('sandbox.html');
const sourceSandbox = readFileSync(join(root, 'public', 'sandbox.html'), 'utf8');
check(sandbox === sourceSandbox, 'sandbox.html is byte-identical to public/sandbox.html');
check(
  /connect-src 'none'/.test(sandbox) && /frame-src 'none'/.test(sandbox),
  "sandbox.html forbids network and frames (connect-src / frame-src 'none')"
);

const forbiddenHosts = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
];
const texty = files.filter(f => /\.(html|css|js|json|svg)$/.test(f));
const offenders = texty.filter(f => forbiddenHosts.some(h => text(f).includes(h)));
check(
  offenders.length === 0,
  `no CDN or font-host references in shipped files${offenders.length ? `: ${offenders.join(', ')}` : ''}`
);

const sw = text('sw.js');
const listed = [...sw.matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]);
check(/const VERSION = "[0-9a-f]{12}"/.test(sw), 'service worker has a content-hash version');
check(
  listed.length > 0 && listed.every(f => files.includes(f)),
  `service worker precaches ${listed.length} files and every one exists`
);
check(
  ['index.html', 'sandbox.html'].every(f => listed.includes(f)),
  'service worker precaches index.html and sandbox.html'
);

const headers = text('_headers');
check(
  /\/sandbox\.html[\s\S]*Cache-Control: public, max-age=31536000, immutable/.test(headers),
  '_headers serves sandbox.html as immutable'
);
check(/\/sw\.js[\s\S]*Cache-Control: no-cache/.test(headers), '_headers never caches sw.js');

const total = files.reduce((n, f) => n + statSync(join(dist, f)).size, 0);
const biggest = files
  .map(f => [f, statSync(join(dist, f)).size])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
console.log(`\n${files.length} files, ${(total / 1e6).toFixed(2)} MB total. Largest:`);
for (const [f, size] of biggest) console.log(`  ${(size / 1e3).toFixed(0).padStart(6)} kB  ${f}`);

const treeHash = createHash('sha256');
for (const f of [...files].sort()) treeHash.update(f).update(readFileSync(join(dist, f)));
console.log('\nArtifact record');
console.log(`  dist tree sha256  ${treeHash.digest('hex')}`);
for (const f of ['index.html', 'sandbox.html', 'sw.js'])
  console.log(`  ${f.padEnd(17)} sha256 ${sha256(join(dist, f))}`);
console.log(`  version           ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll dist checks passed.');
