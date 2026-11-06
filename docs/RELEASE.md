# Release record: NexusIDE 1.0.0

Everything below was produced by commands run on 2026-11-05 on one Windows 11 development PC (Node 22.13.1, pnpm 11.28.3).
Nothing was deployed to a real host, and nothing was committed (see the end of this file).

## Build

```bash
node scripts/bootstrap.mjs          # Node >= 20.19 and pnpm check, then pnpm install --frozen-lockfile
pnpm run build                      # tsc --noEmit, vite build, writes dist/sw.js
pnpm run verify-dist                # 20 artifact checks, prints the hashes below
pnpm preview                        # serves dist/ at http://localhost:4173
```

`pnpm run ci` runs the whole local gate in order: Prettier check, strict type-check, ESLint (complexity, size limits),
design-token contrast, unit tests with per-layer coverage gates, build, verify-dist.

## Artifact

| | |
|---|---|
| Path | `dist/` (static files only; no server code, no environment variables) |
| Version | 1.0.0 (`package.json`) |
| Size | 43 files, 13.08 MB (service worker precaches 41 of them, about 12 MB) |
| Entry download | `index-C7P9aXhB.js` 273.6 kB (87.3 kB gzip), `react-vendor` 141.4 kB (45.5 kB gzip), CSS 29.2 kB (8.3 kB gzip) |
| Loaded on demand | editor chunk 3,246 kB (835.7 kB gzip) plus workers (TypeScript worker 6,004 kB); terminal chunk 287 kB (72.3 kB gzip) |

SHA-256 as printed by `node scripts/verify-dist.mjs` for this build (valid only until the next source change):

```
dist tree     37e6f5448b8dbc5982133bffa3d0d0a8d10e6480c0dea54aee102b287a113138
index.html    3b9e8168a0a8262ff9145e384fcb5f6a74bc7d5bd0adbe69adc9aabc0de0f24c
sandbox.html  e2da725e013d00f20e9d51ab3e31194804552d40c625a7f037eced32f1db686c
sw.js         52c43f105d60656589d063b3af17d92dc8de8d9e18ca6f41392d235592997244
```

The same tree hash was produced by an independent build in a fresh copy of the repository (see below), so the build is
reproducible on this machine. It was not compared across machines or operating systems.

## Hosting prerequisites

The app is static, but **the headers matter**; without them the sandbox and offline mode are weaker or broken.

1. Serve `dist/` over HTTPS (a service worker needs a secure context; `localhost` also works).
2. Apply `dist/_headers` (copied from `public/_headers`; Netlify and Cloudflare Pages are documented to read this format, not
   tested here). It sets the app CSP (`script-src 'self' 'wasm-unsafe-eval'`, `frame-src 'self'`), `nosniff`, no referrer,
   `COOP: same-origin`, `Permissions-Policy`; gives `/sandbox.html` its own strict CSP and
   `Cache-Control: public, max-age=31536000, immutable`; and `/sw.js` `Cache-Control: no-cache`.
3. On a host that ignores `_headers`, set the same headers by hand (nginx `add_header` or equivalent). `/sandbox.html` must be
   cacheable for a year: its URL carries a content hash (`?v=...`), and offline Run depends on the browser keeping it.
4. `.js` must be served as `text/javascript`. The build contains no `.wasm` file (checked); `'wasm-unsafe-eval'` in the CSP
   is allowed but unused.

Not verified: any real host, any CDN, any nginx configuration, and `_headers` being honoured by a hosting provider.

What is enforced without the headers: `index.html` and `sandbox.html` each carry their Content-Security-Policy as a `<meta>`
tag (checked by `verify-dist`), and `index.html` has `<meta name="referrer" content="no-referrer">`. What needs the real
headers: `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and the year-long immutable cache of
`/sandbox.html` (offline Run depends on that cache). `pnpm preview` adds only the immutable `/sandbox.html` header
(`vite.config.ts`); the rest of `_headers` was never exercised as real HTTP headers.

## Rollback

There is no deployment, so there is nothing to roll back yet. For a future one: keep the previous `dist/` directory (or the
previous commit and rebuild); the service worker version is a content hash, so redeploying an older `dist/` makes returning
visitors fetch it on next load and offer the "Reload" toast. User data lives in the browser (IndexedDB database `nexuside`
v1) and is not touched by a deploy; a future schema change would need a migration (none exists in 1.0.0).

## Verification of this build

| Step | Result |
|---|---|
| `pnpm run ci` in the working repository | exit 0: 246 of 246 unit and component tests, 136 of 136 contrast checks, build, 20 dist checks |
| `pnpm run e2e` (Edge 156.0.4314.58 against `vite preview` of this `dist/`) | 48 of 48 checks pass: core 15, security 10, resilience 14, responsive and axe 9 |
| Smoke test (README checklist steps 2 and 3) | covered by E-02 (Web template, Run shows the page) and R-07 (offline: preview, REPL and a reload while offline) |
| Fresh-clone verification | repository copied without `node_modules`, `dist`, `coverage` and `.git` (174 files) into an empty directory; `node scripts/bootstrap.mjs --verify` finished with exit code 0 and built an identical `dist/` (same tree hash) |

Limits of that evidence:

* The fresh-clone install used the local pnpm store (it reported "Lockfile is up to date" and finished in 6.5 s). A cold
  install with an empty store and a clean network was not run.
* The fresh copy ran `pnpm run ci` only. `pnpm run e2e` was run in the working repository against the same `dist/` hash, not
  in the copy.
* Browser tests ran on Edge only, headless, on a development PC. See `KNOWN_LIMITATIONS.md` for everything not tested
  (real phones, screen readers, Firefox, Safari, low-end hardware).
* `.github/workflows/ci.yml` was **not run**; there is no remote. Each command it contains was run locally.

## Git state

The repository contains only its initial commit. All NexusIDE v1.0 work is uncommitted in the working tree, because the working
rules say to commit only when the owner asks. The commit gates listed in the specification's milestones were therefore not
performed. Suggested first commit once approved: `git add -A` (the `.gitignore` excludes `node_modules`, `dist`, `coverage`)
then `git commit -m "feat: NexusIDE v1.0"`.
