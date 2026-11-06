# NexusIDE architecture

Status: describes the implemented v1.0. Test IDs in brackets (E-07, S-01, ...) refer to `docs/TEST_REPORT.md`.

## 1. Goals and non-goals

NexusIDE is a browser IDE for **small web projects**: edit files, preview HTML/CSS/JS/TS/React pages, run JS/TS console
programs, keep everything on the user's device.

Non-goals (also in `KNOWN_LIMITATIONS.md`): VS Code parity, Node/npm, package installs, a real shell, debugging,
extensions, collaboration, accounts, a backend. There is no server code: the product is a static site.

## 2. Environment assessment and assumptions

| Item | Value used for development and tests |
|---|---|
| OS | Windows 11 Home 10.0.26300 |
| Node / pnpm | 22.13.1 / 11.28.3 (`engines.node >= 20.19`) |
| Browser tested | Microsoft Edge 156.0.4314.58 (Chromium), headless, driven by Playwright 1.64.1 |
| Not tested | Firefox, Safari, mobile browsers on real devices, assistive technology (screen readers) |

Assumptions: the user runs a current Chromium-based browser; IndexedDB is available (otherwise a session-only mode
is offered, R-05); the app is served over `https:` or `http://localhost` (secure context).

## 3. Components

```mermaid
flowchart LR
  subgraph App["App origin (strict CSP, no inline script)"]
    UI["React UI<br/>components/*"] --> Stores["Zustand stores<br/>workspace, editor, ui, settings, run, problems"]
    Stores --> Domain["Pure domain<br/>fs, history, search, fuzzy, runTarget, runState, settings"]
    Stores --> Persist["Persistence coordinator<br/>drafts + commits"]
    Persist --> Repo["services/workspaceRepo<br/>IndexedDB (idb), ZIP (JSZip)"]
    UI --> Monaco["Monaco 0.50 + ModelRegistry<br/>(one model per file)"]
    UI --> Runner["runtime/Runner + ReplSession"]
    Runner --> Build["runtime/bundler (Sucrase)<br/>documentBuilder"]
    SW["Service worker<br/>precache of dist/"] -.-> App
  end
  Runner -- "postMessage (validated)" --> Frame
  subgraph Frame["Sandbox iframe: sandbox.html (opaque origin)"]
    Loader["inline loader"] --> Page["document.write(preview HTML)"]
    Loader --> Worker["Worker from Blob<br/>(console programs, REPL)"]
  end
```

Layering rules (enforced by code review, imports, and lint limits): `domain/` imports nothing from React, DOM or
storage. `services/` and `runtime/` own all I/O. `store/` coordinates. `components/` only render and dispatch.

## 4. Domain model

`FsNode { id: uuid, parentId | null, name, kind: 'file' | 'folder', content, createdAt, updatedAt }` (UTC epoch ms).
The workspace is `Record<id, FsNode>`. IDs survive rename, so tabs and Monaco models stay attached.

Rules (all in `domain/fs.ts`, 27 unit tests): names are 1-255 chars, no `/`, `\`, control characters, `.` or `..`;
sibling names are unique case-insensitively; at most 500 nodes, depth 10, 1 MB per file, 20 MB per workspace. Every
operation returns `Result<T>` with a structured `AppError { code, message, details? }` (never throws for user input).

Undo of tree operations stores *inverse changes*, not snapshots (`domain/history.ts`), so undoing a delete never rolls
back edits made to other files in the meantime. Text undo is Monaco's own per-model stack.

## 5. Screens and navigation

```
Start screen (no file open) --- template card --> Workbench
Workbench (desktop): Rail | Explorer or Search | Editor tabs + Monaco | Preview | Console / Problems / Terminal | Status bar
Workbench (<= 760 px): one pane at a time: Files | Editor | Preview | Output, bottom navigation
Overlays: Command palette (Ctrl+Shift+P, F1) | Go to file (Ctrl+P) | Settings | Shortcuts | Templates | Name / Confirm dialogs
Banners: recovery of unsaved edits | storage unavailable
```

Back navigation: the app has no routes; overlays close with Escape and return focus to their opener (A-06).

## 6. State ownership

| State | Owner | Persisted |
|---|---|---|
| File tree, undo history, dirty set | `workspaceStore` | IndexedDB (nodes) |
| Open tabs, active file, cursor, reveal request | `editorStore` | localStorage `nexuside.session.v1` (ids only) |
| Layout (sidebar/panel/preview, dock) | `uiStore` | localStorage `nexuside.layout.v1` |
| Settings | `settingsStore` | localStorage `nexuside.settings.v1`, validated by `parseSettings` |
| Run state machine, console lines | `runStore` + `runReducer` | no |
| Diagnostics | `problemsStore`, filled from Monaco markers | no |
| Live text buffers | Monaco models (`ModelRegistry`) | mirrored to `workspaceStore` on every change |
| Unsaved-edit recovery offer | `recoveryStore` | IndexedDB (drafts) |

## 7. Persistence

IndexedDB database `nexuside`, version 1:

| Store | Key | Value | Purpose |
|---|---|---|---|
| `nodes` | `id` | `FsNode` | committed workspace |
| `drafts` | `fileId` | `{ fileId, content, savedAt }` | crash-recovery journal |
| `backups` | auto-increment | `{ label, createdAt, nodes[] }` | automatic backups, newest 5 kept |
| `meta` | `key` | `{ key, value }` | reserved |

Two durability tiers (`store/persistence.ts`): **drafts** are written ~300 ms after each text change; **commits** write
the changed nodes after 1 s idle (autosave on), immediately on tree changes, on Ctrl+S, and when the tab is hidden. A
commit clears the matching drafts. On startup, drafts that differ from committed text are offered back (R-01, R-02).

**Corrupt data**: `sanitizeNodes` drops unreadable records, re-roots orphans and cycles, and renames duplicate siblings
instead of losing data; the user is told (R-03). **Migration**: `upgrade(db, oldVersion)` in `services/db.ts` is the single
place for schema changes; the pre-1.0 prototype record shape is accepted by `coerceNode` (unit-tested with a labelled
sample). **Quota**: `QuotaExceededError` becomes `QUOTA_EXCEEDED`, shown in the status bar and a toast, and saving
recovers when space returns (R-04). **Multiple tabs**: last writer wins; other tabs are warned via `BroadcastChannel` (R-09).

Retention and deletion: backups are made before any operation that replaces the workspace (template, ZIP import, backup
restore); Settings > Your data lists and deletes them; "Delete all data" removes IndexedDB and all `nexuside.*` keys.

## 8. Running code

### 8.1 Run targets (`domain/runTarget.ts`)

"Run" picks: an HTML file runs as a page; scripts and styles that belong to a page run through `index.html`; otherwise
a `.js/.ts` file runs as a console program; anything else gives `UNSUPPORTED_RUNTIME` with the language named (E-10).

### 8.2 Build (`runtime/bundler.ts`, `documentBuilder.ts`)

Sucrase transpiles TS/JSX and converts ES modules to a tiny CommonJS module graph embedded in one script. Resolution:
relative paths, extension and `index` probing, `.js` to `.ts` mapping, JSON, CSS (hoisted to `<style>`). Bare imports are
errors (`UNSUPPORTED_DEPENDENCY`) except `react`, `react-dom`, `react/jsx-runtime`, vendored from `node_modules` at build
time (no CDN). External `<script src>`/`<link href>` URLs are removed with a console notice. Lookups use own-property
checks and `Map`s, so names such as `constructor` cannot resolve to `Object.prototype` members (unit-tested).

### 8.3 Sandbox

Every run creates a fresh `<iframe sandbox="allow-scripts allow-forms" allow="">` loading `sandbox.html?v=<hash>`:

* **Opaque origin** (no `allow-same-origin`): `window.origin === "null"` (S-03), so no access to the app's IndexedDB,
  localStorage, cookies or DOM (S-01).
* **CSP** (`src/runtime/csp.ts`, mirrored in `public/sandbox.html`, equality unit-tested): `default-src 'none'`,
  `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'`, `img-src data: blob:`, scripts only inline/blob
  (necessarily, to run user code).
* **Page previews** run on the frame's main thread via `document.open/write`. The bridge adds a 1 s heartbeat; the host
  stops a preview that is silent for the run timeout (endless loop, or navigated away). In Chromium the frame does not
  block the host thread (S-04).
* **Console programs and the REPL** run in a `Worker` created *inside* the frame, so the host kills them by removing the
  frame, and an endless loop cannot touch the page (S-05). Output is capped at the source (5000 lines) and batched at the
  host (S-06).
* **Handshake and retry**: the frame must send `ready` within 2 s; otherwise it is recreated (up to 2 times). This
  matters because a frame created right after a hung one can land in the still-dying renderer.
* **Protocol** (`runtime/protocol.ts`): the host accepts only messages whose `event.source` is that frame's window and
  that pass `parseSandboxEvent` (schema check, size clamp, `Map` dispatch). The loader inside the frame accepts only
  messages from `parent`.

Run state machine (`domain/runState.ts`): `idle -> building -> running -> finished | failed | timed-out | stopped`.
Events carry a run id; late messages from a destroyed sandbox are ignored.

## 9. Threat model

**Assets**: the user's workspace and settings in the app origin; the user's other browser data; the user's machine.
**Actors**: (a) the user writing code by accident (loops, floods); (b) a hostile project the user imports or pastes;
(c) a hostile page *served from a different site* is out of scope (no cross-site messaging is accepted).
**Trust boundary**: everything inside the sandbox frame is untrusted; everything it sends is untrusted input.

| Threat | Control | Evidence |
|---|---|---|
| Hostile code reads app data (IndexedDB, localStorage, cookies, DOM) | opaque origin | S-01, S-03, S-08 |
| Hostile code sends data out: fetch, XHR, WebSocket, beacon, images, dynamic import, workers, nested frames | CSP `connect-src/img-src/frame-src/worker-src` | S-01 (20 attempts), S-02 (8), network canary shows 0 requests |
| Navigates its own frame to an attacker URL | host CSP `frame-src 'self'`; frame ends on an error page; watchdog stops the run; form/anchor navigation intercepted | S-10 (0 HTTP requests) |
| Opens popups, navigates the app, downloads | sandbox flags omit popups/top-navigation/downloads | S-01 |
| Spins the CPU | console programs: Worker + timeout; previews: heartbeat watchdog + frame isolation | S-04, S-05 |
| Floods output | source cap, batching, memoised rows | S-06 |
| Forges messages to the host | `event.source` check + schema validation + prototype-safe dispatch | unit tests, S-07 |
| Malicious ZIP: zip-slip, absolute path, zip bomb, binary, `node_modules` | path validation, entry and expanded-size caps, UTF-8 check | unit tests, S-09 |
| XSS in the app shell | no `dangerouslySetInnerHTML`; production CSP `script-src 'self'` (no inline); only own-origin assets | E-01, A-* run under the CSP |
| Secrets in the client bundle | there are none: no accounts, no API keys, no telemetry; `.env.example` lists no variables | `verify-dist` |

**Residual risks (accepted, documented)**

1. *DNS/TCP side channel on navigation*: Chromium may resolve and connect to a host named by a blocked navigation before
   refusing (observed: 1 TCP connection, 0 HTTP requests; attributed to the nested-iframe attempt in S-01). The sandbox
   holds no secrets, so what could be encoded is the previewed project's own code.
2. *No memory cap*: browsers give no per-frame RAM limit. A program that allocates without bound can exhaust memory
   (not tested on purpose: it can crash the browser). A Worker is killed at the timeout; a page preview by the watchdog.
3. *Other browsers*: hang isolation of page previews was verified on Chromium only. If another engine runs the frame on
   the host thread, an endless loop in a *page* preview can freeze that tab.
4. *The dev server* (`pnpm dev`) sets no CSP headers; use `pnpm preview` or a real host to evaluate security.

## 10. Permission matrix

| Capability | App shell | Sandbox page | Sandbox Worker |
|---|---|---|---|
| Read/write app IndexedDB, localStorage | yes | no | no |
| Network (same origin: its own assets) | yes | no | no |
| Network (anywhere else) | no (`connect-src 'self'`) | no | no |
| DOM of the app | yes | no | no |
| Open windows, navigate top, download, modals | no | no | n/a |
| Camera, microphone, geolocation, USB, serial | no (`Permissions-Policy`) | no (`allow=""`) | no |

## 11. External API contracts

None. There is no backend. Hosting prerequisites are static files plus the headers in `public/_headers` (applies as-is
on Netlify/Cloudflare Pages; translate for nginx/Apache). `vite.config.ts` also injects the app CSP as a `<meta>` so a
host that cannot set headers is still protected (the sandbox keeps its own meta CSP).

## 12. Offline behaviour

After the first complete load: the app shell, editor, terminal, Monaco workers, templates and React runtime are
precached by a build-generated service worker (`dist/sw.js`). The sandbox page cannot be served by a service worker
(opaque-origin frames bypass it, measured), so it is requested with a content-hash URL, served `immutable`, and warmed
into the HTTP cache at idle (`html[data-sandbox-warm]`). If the browser cache is cleared while offline, Run reports
that the sandbox could not start. Nothing in NexusIDE needs a network at run time, and nothing is ever uploaded.
Updates: a new build installs in the background; the user is offered "Reload" and the page never reloads by itself.

## 13. Decisions

* **ADR-1 Browser-contained sandbox, not WebContainers or remote containers.** WebContainers need cross-origin
  isolation headers and a third-party runtime/licence; remote containers need server infrastructure that could not be
  verified here. Cost: no Node, no npm, no shell, no hard memory cap.
* **ADR-2 Sucrase instead of esbuild-wasm/TypeScript.** About 100 KB, synchronous, handles TS/JSX/ESM. No type
  checking at run time (Monaco shows type errors; Run does not wait for them), no top-level await.
* **ADR-3 Plain CSS with design tokens.** Three themes verified by a script (`pnpm run contrast`, 136 checks); no CSS
  framework to ship or configure.
* **ADR-4 Trimmed Monaco bundle.** Only the languages NexusIDE claims are imported (editor chunk 3.2 MB, 836 KB gzip).
* **ADR-5 Service worker + HTTP cache for offline**, because a sandboxed frame cannot use a service worker.
* **ADR-6 Fonts self-hosted from npm (OFL)**: Instrument Sans, JetBrains Mono. Fontshare was not used because its
  licence page could not be read during research (`DESIGN_REFERENCES.md`).

## 14. Budgets and measurements

Measured by the tests on the development machine (not a mid-range device): opening a 900 KB file and 20 keystrokes are
recorded in `TEST_REPORT.md` (R-10). Bundle sizes are in `RELEASE.md`. Performance on low-end hardware and phones was
**not measured**.
