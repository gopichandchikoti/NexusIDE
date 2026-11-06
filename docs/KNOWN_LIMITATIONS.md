# Known limitations

Everything here is a deliberate scope decision or a measured constraint. Nothing is hidden elsewhere.

## Product scope

| # | Limitation | Why | Impact |
|---|---|---|---|
| L1 | **Not VS Code.** No debugger, extensions, git, tasks, multi-root workspaces, split editors, minimap-based navigation beyond Monaco's own. | v1.0 scope | Use it for small projects and demos. |
| L2 | **No Node, no npm, no `import` of packages.** Only `react`, `react-dom`, `react/jsx-runtime` resolve. Anything else fails with `UNSUPPORTED_DEPENDENCY`. | Browser-contained sandbox with no network (ADR-1) | Single-file libraries can be pasted into the project. |
| L3 | **Runs HTML, CSS, JS, TS, JSX/TSX only.** Python, Rust, Go, Java, C, C++, shell, YAML, XML and Markdown are edit-only (highlighting); Run says so. | Honest scope | - |
| L4 | **Text files only.** Binary files (images, fonts) are skipped on ZIP import and cannot be created. Limits: 500 files/folders, depth 10, 1 MB per file, 20 MB per workspace, 25 MB expanded ZIP. | Protect the tab and IndexedDB quota | Use data URIs or inline SVG for images. |
| L5 | **The "terminal" is a JavaScript REPL**, not a shell. No file system, no processes, no network. | A shell needs a real OS-level sandbox | `help`, `clear`, `reset` and JavaScript. |
| L6 | **No type checking at run time.** Type errors are shown in Problems; Run executes anyway. React typings are a minimal stub (hooks, `createRoot`), everything else is `any`. | Sucrase transpiles only (ADR-2) | - |
| L7 | **No top-level `await`** in modules; no `import.meta`; `require("x")` inside strings can be misread as an import. | CommonJS module graph | Wrap async code in a function. |
| L8 | **No "replace in all files"**, no drag-and-drop moving of files, one workspace at a time (backups act as snapshots). | Not built | Export/import ZIP; rename via dialog. |
| L9 | **Resource display is limited**: elapsed time, output count, storage use. Browsers expose no per-frame CPU or memory figure. | Platform | - |

## Platform and security

| # | Limitation | Detail |
|---|---|---|
| S1 | **No memory cap.** A program allocating without bound can exhaust browser memory; only wall-clock timeouts are enforced. This was not stress-tested because it can crash the test browser. |
| S2 | **Hang protection for page previews relies on Chromium** keeping the frame off the host thread (measured on Edge 156). Firefox and Safari were **not tested**; an endless loop in a *page preview* may freeze the tab there. Console programs always run in a Worker. |
| S3 | **Residual DNS/TCP side channel**: a script that navigates its own frame makes Chromium dial the target before refusing. No HTTP request is delivered (S-10). The sandbox holds no secrets. |
| S4 | **`pnpm dev` is not a security boundary** (no CSP headers). Evaluate with `pnpm preview` or a real host. |
| S5 | **Pages cannot navigate or submit forms.** `location.href = ...`, form posts and external links are blocked or neutralised; anchors to `#hash` work. Pages needing a server (fetch, XHR, WebSocket) cannot work. |
| S6 | `alert`, `confirm` and `prompt` do not open dialogs; they log to the console (`confirm` returns `false`, `prompt` returns `null`). |
| S7 | **The Run right after a stopped (hung) preview can take a few seconds to start.** Chromium keeps the stuck renderer alive for a short while and a new frame can land in it. Measured on Edge 156: about 2.3 s with no debugger attached (4 of 4 runs of a CDP-free probe), about 10 s while Playwright's debugger was attached to the stuck frame (the same happens with DevTools open on it). The runner waits up to 22 s in that situation and logs "The browser is still shutting down the previous stuck preview; waiting for it". Other browsers were not measured. |

## Offline and storage

| # | Limitation | Detail |
|---|---|---|
| O1 | Offline use needs one complete online visit first (service worker precache, about 12 MB). Verified on Chromium. |
| O2 | The sandbox page is served from the HTTP cache (a service worker cannot serve sandboxed frames). If the browser cache is cleared while offline, Run reports that the sandbox could not start until you reconnect once. |
| O3 | Data lives in the browser profile. Clearing site data, private windows and some browser "cleanup" tools delete it. Export a ZIP for anything important. In a private window without IndexedDB the app works session-only and says so. |
| O4 | Two tabs editing one workspace is last-writer-wins (a warning is shown to the other tab). |

## Testing coverage (what was **not** tested)

* Real mobile devices and touch gestures beyond Playwright's touch emulation (360x740 viewport, `hasTouch`).
* Screen readers (NVDA, VoiceOver, TalkBack). Automated axe-core checks, keyboard-only checks and ARIA structure were done; a
  human screen-reader pass was not.
* Firefox, Safari, Chrome (non-Edge Chromium builds), older Chromium.
* Performance on low-end hardware; values in `TEST_REPORT.md` come from the development machine.
* Drag-resizing of panels (the library handles pointer and keyboard; not exercised by an automated test).
* The GitHub Actions workflow in `.github/workflows/ci.yml` was **not run** (no repository remote); each command it runs was run locally.
* Installing the app on a phone, and any Android/iOS packaging (not applicable: web delivery only).

## Spec items interpreted

* "Integrated terminal only when a genuinely isolated execution environment is available": satisfied by the sandboxed
  Worker REPL; there is deliberately no shell.
* Milestone exit gates ask for a Git commit. The rulebook says never to commit unless asked, so **no commits were made**;
  the repository has only its initial commit and everything else is uncommitted work awaiting the owner.
