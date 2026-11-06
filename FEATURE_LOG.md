# Feature log

Newest first. Entry format from the Universal Application Rulebook. Nothing has been committed (see
`docs/KNOWN_LIMITATIONS.md`); these entries are the record of the work.

## [2026-11-05] Final verification: offline modules, stuck-preview recovery

**Type**: Fix | Test | Docs
**Author**: agent

### What changed

Two browser checks failed in the last full run and were diagnosed instead of loosened. R-07: offline, the lazily loaded
terminal chunk was not served because the host sends `Vary: Origin` and module-script requests did not match the precache
entry; the service worker now matches with `ignoreVary`. S-04: the next Run after a hung preview failed because the stuck
renderer outlived the retry budget (about 2.3 s without a debugger in a CDP-free probe, about 10 s with Playwright
attached); after a stalled run the runner now waits up to 22 s and says why. R-07 also reloads the page while offline.
Generated `docs/TEST_REPORT.md`, wrote `docs/RELEASE.md`, added limitation S7.

### Why

Specification sections 5 and 9 (timeouts, cleanup, offline behaviour); never report a check as passing that did not pass.

### Files touched

- `scripts/sw.template.js`, `src/runtime/runner.ts`, `src/runtime/runner.test.ts` (2 new tests)
- `e2e/suites/resilience.mjs`, `e2e/suites/security.mjs`, `scripts/test-report.mjs`
- `docs/TEST_REPORT.md`, `docs/RELEASE.md`, `docs/KNOWN_LIMITATIONS.md`, `README.md`

### Validation

`pnpm run ci` exit 0 (246 unit tests); `pnpm run e2e` 48 of 48 on Edge 156; fresh-clone `bootstrap.mjs --verify` exit 0 with an
identical `dist/` tree hash. Details and limits in `docs/RELEASE.md`.

### Migration / Setup notes

None. Returning visitors get a new service worker and the opt-in "Reload" toast.

## [2026-11-05] Release record, offline sandbox, documentation

**Type**: Docs | Config
**Author**: agent

### What changed

Added README, ARCHITECTURE (with threat model), FEATURE_MATRIX, TEST_REPORT (generated), RELEASE, KNOWN_LIMITATIONS,
DESIGN_REFERENCES. Added `scripts/bootstrap.mjs`, `verify-dist.mjs`, `test-report.mjs`, a CI workflow, `.env.example`
(no variables). Made Run work offline: `sandbox.html` has an inline loader, a content-hash URL, an immutable cache header,
and an idle warm-up, because a service worker cannot serve a sandboxed frame.

### Why

Specification section 3 deliverables; the "offline dependencies" requirement; R-07 showed Run failed offline.

### Files touched

- `README.md`, `docs/*.md`, `FEATURE_LOG.md`, `.github/workflows/ci.yml`, `.env.example`, `.gitignore`
- `scripts/bootstrap.mjs`, `scripts/verify-dist.mjs`, `scripts/test-report.mjs`
- `public/sandbox.html` (loader inlined; `sandbox.js` removed), `public/_headers`, `src/pwa/warm.ts`, `src/runtime/sandboxHost.ts`

### Validation

`pnpm run ci` exit 0; `pnpm run e2e` results in `docs/TEST_REPORT.md`.

### Migration / Setup notes

Hosts must serve `public/_headers` (or equivalent). `/sandbox.html` must be cacheable for a year (its URL is versioned).

## [2026-11-05] Milestone 5: hardening found by testing, service worker

**Type**: Fix | Feature | Test
**Author**: agent

### What changed

Browser test suites (core, security, resilience, responsive/axe) were written and run in Edge against the production
build. They found and drove fixes for: form-submit navigation from the sandbox (bridge guard + host CSP `frame-src`),
output floods stalling the UI (source cap, batching, memoised rows), a new frame landing in a dying renderer (ready
handshake with retries), focus stealing from dialogs (`focusin` guard), tree keyboard focus, tablist semantics,
contrast, REPL type-ahead and screen-reader noise, REPL timeout message, prototype-name lookups, app shell layout.
Added a build-generated precaching service worker with an opt-in "new version" reload.

### Why

Specification sections 5 and 9 (security review, malicious code tests, timeouts, cleanup, accessibility).

### Files touched

- `src/runtime/{bridgeSource,runner,outputBuffer,repl,sandboxHost,protocol}.ts`, `src/components/ui/{Modal,ChunkBoundary}.tsx`
- `src/components/editor/Tabs.tsx`, `src/components/files/*`, `src/components/panel/{TerminalView,ConsoleView,BottomPanel}.tsx`
- `src/domain/{replLine,treeView,languages}.ts`, `src/pwa/*`, `src/styles/*`, `scripts/{contrast,sw.template}.js`, `vite.config.ts`
- `e2e/**`

### Validation

Final run recorded in `docs/TEST_REPORT.md`. Unit and component tests: see the same file. `pnpm run ci` exit 0.

### Migration / Setup notes

None.

## [2026-11-05] Milestone 4: templates, diagnostics, polish, error surfaces

**Type**: Feature
**Author**: agent

### What changed

Four templates (Web page, TypeScript console, React 18.3.1, Blank), Problems panel from Monaco markers, Settings (themes,
editor, run timeout, data, backups, delete-all), shortcuts dialog, phone layout with bottom navigation, reduced motion,
three themes with computed contrast, error surfaces (unsupported runtime and dependency, chunk-load failure, quota,
storage unavailable, corrupt data), multi-tab notice.

### Why

Specification sections 4, 7 and the M4 gate.

### Files touched

- `src/data/templates.ts`, `src/components/**`, `src/styles/**`, `src/store/**`, `src/domain/settings.ts`

### Validation

`E-*`, `R-*`, `A-*` browser checks; `pnpm run contrast`.

### Migration / Setup notes

None.

## [2026-11-05] Milestone 3: isolated runner and preview

**Type**: Feature
**Author**: agent

### What changed

Sandboxed iframe runtime: opaque origin, CSP, validated postMessage protocol, Sucrase-based module bundler, preview document
builder, Worker-based console programs with timeouts, REPL, run state machine, console panel, xterm terminal.

### Why

Specification section 5 (no user code in a privileged context; documented threat model) and M3.

### Files touched

- `src/runtime/**`, `public/sandbox.html`, `src/domain/{runState,runTarget}.ts`, `src/components/{preview,panel}/**`

### Validation

43 runtime unit tests at the time; browser checks `E-02`, `E-05`, `E-12`, `E-13`, `E-15`, `S-01`..`S-10`.

### Migration / Setup notes

None.

## [2026-11-05] Milestone 2: editor, file tree, persistence

**Type**: Feature
**Author**: agent

### What changed

Pure file-tree domain with validation and limits, inverse-change undo, search (zero-length-safe, time-boxed), fuzzy
matching, IndexedDB persistence with drafts / commits / backups and sanitising of damaged data, ZIP import and export with
zip-slip and zip-bomb defences, Monaco integration (per-file models), command palette and shortcuts, crash recovery.

### Why

Specification section 4 and M2.

### Files touched

- `src/domain/**`, `src/services/**`, `src/store/**`, `src/editor/**`, `src/app/**`

### Validation

Unit tests (domain, services, store); `E-03`, `E-06`..`E-09`, `R-01`..`R-04`.

### Migration / Setup notes

IndexedDB database `nexuside` v1 (the prototype never persisted anything).

## [2026-11-05] Milestone 1: scope, security design, baseline

**Type**: Refactor | Docs
**Author**: agent

### What changed

Audited the unfinished prototype found in the repository: it had no entry point, an empty shortcuts hook, a fabricated
extensions marketplace, CDN fonts, a Tailwind-purple look, a same-origin blob preview, a search loop that cannot terminate
on zero-length matches, and unvalidated ZIP import. Original `src/` was backed up outside the repository and replaced.
Chose the browser-contained sandbox (ADR-1), defined supported languages, limits, and the threat model; installed
Sucrase, fontsource fonts, Playwright, axe-core, jsdom, fake-indexeddb; removed Tailwind, framer-motion and
@monaco-editor/react (which loads Monaco from a CDN).

### Why

Specification section 0 and M1; the rulebook's requirement to inspect before changing.

### Files touched

- `package.json`, `vite.config.ts`, `tsconfig.json`, `.eslintrc.cjs`, `docs/superpowers/plans/2026-11-05-nexuside-v1.md`

### Validation

`tsc --noEmit`, ESLint, Vitest from the first domain module onward.

### Migration / Setup notes

The prototype used database `nexus-ide` which the prototype never wrote to; v1.0 uses `nexuside`.
