# Feature matrix (spec section 4)

Status: **Done** (implemented and covered by an automated test), **Partial** (implemented with a stated gap),
**Not done**. Test IDs refer to `TEST_REPORT.md`; "unit" means the Vitest suites.

| # | Required v1.0 feature | Status | What exists | Evidence |
|---|---|---|---|---|
| 1 | File tree, create / rename / delete | Done | Explorer with keyboard tree, context menu, toolbar, name validation, undo of tree operations | E-06, A-06, unit `fs`, `history`, `view` |
| 2 | Tabs | Done | Open files, dirty marker, close via Delete / Alt+W / middle-click / x, restored after reload | E-03, A-06 |
| 3 | Search | Done | Workspace search: case, whole word, regex; zero-length-safe; capped and time-boxed; click to reveal line. Find / replace *inside* a file is Monaco's | E-08, unit `logic` |
| 4 | Command palette, shortcuts | Done | 40+ commands, fuzzy search, Go to file, single registry drives palette + shortcuts + help dialog | E-07, unit `app` |
| 5 | Monaco highlighting | Done | JS, TS, JSON, CSS, HTML, Markdown, XML, YAML, shell, Python, Rust, Go, Java, C, C++ | visible in E-04, E-12 screenshots |
| 6 | Diagnostics | Done | Monaco markers for JS/TS/JSON/CSS/HTML across all files, Problems panel, status bar counts, click to jump | E-04 (TypeScript) |
| 7 | Autocomplete | Partial | Monaco's built-in completion for JS/TS/CSS/HTML/JSON. React gets a minimal typing stub only | not individually tested |
| 8 | Configurable themes | Partial | 3 app themes + system, 4 editor themes (auto, graphite, paper, contrast, midnight), font size, indent, wrap, minimap, line numbers. Switching an *editor* theme from Settings has no dedicated e2e test; all theme colours are contrast-checked | E-07 (app theme), A-01..A-03, `pnpm run contrast` |
| 9 | Workspace persistence, autosave | Done | IndexedDB, 2-tier autosave, Ctrl+S, autosave off mode | E-03, R-13, unit `store` |
| 10 | Import / export ZIP | Done | Export with folders; import validated (zip-slip, bomb, binary, `node_modules`) | E-09, S-09, unit `services` |
| 11 | Recovery after crash | Done | Draft journal + recovery banner (Restore / Discard); backups before destructive replace | R-01, R-02, E-11 |
| 12 | Preview pane with console / output and run states | Done | Sandboxed page preview, console (levels, timestamps, text tags), run chip: Ready, Building, Running, Finished, Failed, Timed out, Stopped | E-02, E-12, E-15 |
| 13 | Terminal only if genuinely isolated | Done (JS REPL) | xterm REPL evaluating in a sandboxed Worker; typed-ahead input, history, Ctrl+C reset | E-13, S-07 |
| 14 | Starter templates (HTML / CSS / JS / TS / React) with versioned dependencies | Done | Web page, TypeScript console, React 18.3.1 (bundled; `package.json` records versions), Blank | E-02, E-05, E-12 |
| 15 | Build / run controls, lifecycle, timeouts, resource usage | Partial | Run, Stop, Run again; per-run ids; timeouts and watchdog; elapsed time and output count; storage use. **No CPU / RAM figure** (browser does not expose one) | S-04, S-05, S-07 |
| 16 | Responsive split panes, accessible navigation, customisable layout | Done | Resizable panels (keyboard-operable handles), preview docked right / below, panes hideable, layout persisted, phone layout with bottom navigation | E-14, A-07, A-08 |
| 17 | Error surfaces: unsupported runtime, offline dependencies, quota | Done | `UNSUPPORTED_RUNTIME`, `UNSUPPORTED_DEPENDENCY`, chunk-load failure with retry, quota banner, storage-unavailable mode, corrupt-data report | E-10, R-03..R-08, unit `runtime` |

## Spec section 1-2 standards

| Standard | Status | Evidence |
|---|---|---|
| Original identity, no borrowed assets | Done | Own logo, tokens, OFL fonts self-hosted |
| Dark / light / high-contrast, accessible contrast | Done | 136 automated contrast checks; axe-core on 3 themes, 0 violations (A-01..A-05, A-09) |
| Reduced motion | Done | OS preference and a Settings override (R-11) |
| Large touch targets on mobile | Done | every control >= 44 px at 360 px width (A-07) |
| Keyboard accessibility | Done | A-06 (skip link, tree, tabs, dialog focus trap and restore) |
| No accounts, no telemetry | Done | none exist; `.env.example` lists no variables |
| TypeScript strict, lint limits | Done | `tsc --noEmit`, ESLint with complexity <= 10, depth <= 3, <= 4 params, functions <= 80 lines, files <= 400, lines <= 120 |
| Screenshots of key screens, small screens | Done | `docs/screenshots/` |

## Explicitly not built

Replace across files, drag-and-drop moving, multiple workspaces, binary assets, git, debugger, extensions, split editors,
formatters beyond Monaco's built-ins (no Prettier in the browser), a shell. See `KNOWN_LIMITATIONS.md`.
