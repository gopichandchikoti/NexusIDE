import { RUNTIME_VERSIONS } from '@/runtime/vendor';

export interface Template {
  readonly id: 'blank' | 'web' | 'typescript' | 'react';
  readonly name: string;
  readonly summary: string;
  readonly tags: readonly string[];
  /** What "Run" does with this template */
  readonly runs: 'page' | 'console' | 'nothing';
  readonly files: Readonly<Record<string, string>>;
}

const WEB_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Steeping timer</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Steeping timer</h1>
      <p class="hint">Pick a tea, press start. Output also goes to the Console panel.</p>
      <div class="choices" id="choices"></div>
      <p class="clock" id="clock" aria-live="polite">0:00</p>
      <button id="toggle" type="button">Start</button>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`;

const WEB_CSS = `:root {
  --paper: #f4efe4;
  --ink: #232018;
  --leaf: #3f6b3a;
  --leaf-dark: #2c4d28;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: Georgia, 'Times New Roman', serif;
  background: var(--paper);
  color: var(--ink);
}
main { width: min(26rem, 92vw); text-align: center; padding: 1.5rem 0; }
h1 { font-size: 1.8rem; margin: 0 0 .25rem; }
.hint { margin: 0 0 1.25rem; opacity: .7; }
.choices { display: flex; gap: .5rem; justify-content: center; flex-wrap: wrap; margin-bottom: 1.25rem; }
.choices button { background: transparent; color: var(--ink); border: 1px solid var(--ink); padding: .5rem .8rem; border-radius: 999px; font: inherit; cursor: pointer; }
.choices button[aria-pressed='true'] { background: var(--leaf); border-color: var(--leaf); color: #fff; }
.clock { font-size: 4rem; font-variant-numeric: tabular-nums; margin: 0 0 1rem; }
#toggle { background: var(--leaf-dark); color: #fff; border: 0; border-radius: 6px; padding: .75rem 2rem; font: inherit; cursor: pointer; min-height: 44px; }
`;

const WEB_JS = `// Plain browser JavaScript. This file runs as a classic script, so top-level names are global.
const TEAS = [
  { name: 'Green', seconds: 75 },
  { name: 'Oolong', seconds: 150 },
  { name: 'Black', seconds: 210 },
];

let chosen = TEAS[0];
let remaining = chosen.seconds;
let timerId = null;

const clock = document.getElementById('clock');
const toggle = document.getElementById('toggle');
const choices = document.getElementById('choices');

function format(total) {
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return m + ':' + s;
}

function render() {
  clock.textContent = format(remaining);
  toggle.textContent = timerId === null ? 'Start' : 'Stop';
  for (const button of choices.children) {
    button.setAttribute('aria-pressed', String(button.dataset.name === chosen.name));
  }
}

function stop() {
  clearInterval(timerId);
  timerId = null;
}

function tick() {
  remaining -= 1;
  if (remaining <= 0) {
    remaining = 0;
    stop();
    console.log(chosen.name + ' is ready.');
  }
  render();
}

for (const tea of TEAS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.name = tea.name;
  button.textContent = tea.name + ' ' + format(tea.seconds);
  button.addEventListener('click', () => {
    stop();
    chosen = tea;
    remaining = tea.seconds;
    console.log('Selected', tea.name);
    render();
  });
  choices.appendChild(button);
}

toggle.addEventListener('click', () => {
  if (timerId === null && remaining > 0) timerId = setInterval(tick, 1000);
  else stop();
  render();
});

render();
`;

const TS_MAIN = `import { primesUpTo, describe } from './primes';

// A console program: Run executes this file in an isolated Worker and prints to the Console panel.
const limit = 50;
const primes: number[] = primesUpTo(limit);

console.log(\`Primes up to \${limit}:\`, primes);
console.log(describe(primes));

const byLastDigit = new Map<number, number[]>();
for (const p of primes) {
  const digit = p % 10;
  byLastDigit.set(digit, [...(byLastDigit.get(digit) ?? []), p]);
}
console.log('Grouped by last digit:', byLastDigit);

// Try a type error below: Problems shows it, and Run still works (types are checked in the editor, not at run time).
// const oops: string = 42;
`;

const TS_PRIMES = `export function primesUpTo(limit: number): number[] {
  const composite = new Array<boolean>(limit + 1).fill(false);
  const found: number[] = [];
  for (let n = 2; n <= limit; n++) {
    if (composite[n]) continue;
    found.push(n);
    for (let multiple = n * n; multiple <= limit; multiple += n) composite[multiple] = true;
  }
  return found;
}

export function describe(values: readonly number[]): string {
  const last = values[values.length - 1];
  return \`\${values.length} primes, largest \${last ?? 'none'}\`;
}
`;

const REACT_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tally</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const REACT_MAIN = `import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
`;

const REACT_APP = `import { useState } from 'react';

interface Counter {
  id: number;
  label: string;
  count: number;
}

export function App() {
  const [counters, setCounters] = useState<Counter[]>([
    { id: 1, label: 'Coffees', count: 0 },
    { id: 2, label: 'Commits', count: 0 },
  ]);

  const bump = (id: number, by: number) =>
    setCounters(list => list.map(c => (c.id === id ? { ...c, count: Math.max(0, c.count + by) } : c)));

  return (
    <main className="tally">
      <h1>Tally</h1>
      <ul>
        {counters.map(c => (
          <li key={c.id}>
            <span className="label">{c.label}</span>
            <button aria-label={\`Decrease \${c.label}\`} onClick={() => bump(c.id, -1)}>−</button>
            <output>{c.count}</output>
            <button aria-label={\`Increase \${c.label}\`} onClick={() => bump(c.id, 1)}>+</button>
          </li>
        ))}
      </ul>
      <p className="total">Total: {counters.reduce((sum, c) => sum + c.count, 0)}</p>
    </main>
  );
}
`;

const REACT_CSS = `body { margin: 0; font-family: system-ui, sans-serif; background: #f2efe9; color: #1d1b16; }
.tally { max-width: 24rem; margin: 3rem auto; padding: 0 1rem; }
ul { list-style: none; padding: 0; margin: 0 0 1rem; }
li { display: flex; align-items: center; gap: .75rem; padding: .5rem 0; border-bottom: 1px solid #cfc8b8; }
.label { flex: 1; }
button { min-width: 44px; min-height: 44px; font-size: 1.25rem; border: 1px solid #1d1b16; background: #fff; border-radius: 6px; cursor: pointer; }
output { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; font-size: 1.25rem; }
.total { font-weight: 600; }
`;

const REACT_PACKAGE = JSON.stringify(
  {
    '//': 'Informational. These exact versions are bundled into the NexusIDE preview runtime. npm install is not available in the browser sandbox.',
    name: 'tally',
    private: true,
    dependencies: { react: RUNTIME_VERSIONS.react, 'react-dom': RUNTIME_VERSIONS['react-dom'] },
  },
  null,
  2
);

const BLANK_README = `# New workspace

Add files with the **New file** button, or start from a template (Command palette: "Start from a template").

NexusIDE runs HTML, CSS, JavaScript, TypeScript and React in an isolated browser sandbox.
It does not run Node, install packages, or execute Python/Rust/Go/Java/C++ (those are edit-only).
`;

export const TEMPLATES: readonly Template[] = [
  {
    id: 'web',
    name: 'Web page',
    summary: 'HTML, CSS and plain JavaScript: a steeping timer you can edit live.',
    tags: ['HTML', 'CSS', 'JS'],
    runs: 'page',
    files: { 'index.html': WEB_HTML, 'style.css': WEB_CSS, 'app.js': WEB_JS },
  },
  {
    id: 'typescript',
    name: 'TypeScript console',
    summary: 'Typed modules that run as a console program in an isolated Worker.',
    tags: ['TS'],
    runs: 'console',
    files: { 'src/main.ts': TS_MAIN, 'src/primes.ts': TS_PRIMES },
  },
  {
    id: 'react',
    name: `React ${RUNTIME_VERSIONS.react}`,
    summary: 'A TSX app with hooks. React is bundled with the preview, so it works offline.',
    tags: ['TSX', 'React'],
    runs: 'page',
    files: {
      'index.html': REACT_HTML,
      'src/main.tsx': REACT_MAIN,
      'src/App.tsx': REACT_APP,
      'src/styles.css': REACT_CSS,
      'package.json': `${REACT_PACKAGE}\n`,
    },
  },
  {
    id: 'blank',
    name: 'Blank',
    summary: 'Just a README. Add your own files.',
    tags: [],
    runs: 'nothing',
    files: { 'README.md': BLANK_README },
  },
];

export function getTemplate(id: Template['id']): Template {
  return TEMPLATES.find(t => t.id === id) ?? (TEMPLATES[TEMPLATES.length - 1] as Template);
}
