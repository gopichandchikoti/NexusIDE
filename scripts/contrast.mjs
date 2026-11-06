// Computes WCAG 2.2 contrast ratios for the design tokens in src/styles/tokens.css and fails the build below AA.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');

function parseThemes(source) {
  const themes = {};
  const blocks = source.matchAll(
    /(:root(?:\[data-theme='(\w+)'\])?(?:,\s*:root\[data-theme='(\w+)'\])?)\s*\{([^}]*)\}/g
  );
  for (const [, , a, b, body] of blocks) {
    const name = b ?? a;
    if (!name) continue;
    const vars = {};
    for (const [, key, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[key] = value;
    themes[name] = { ...(themes[name] ?? {}), ...vars };
  }
  return themes;
}

const channel = c => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = hex => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = 4.5;
const UI = 3;
const PAIRS = [
  ['text', ['bg', 'surface', 'surface-2', 'surface-3'], TEXT],
  ['text-muted', ['bg', 'surface', 'surface-2', 'surface-3'], TEXT],
  ['text-faint', ['bg', 'surface', 'surface-2', 'surface-3'], TEXT],
  ['accent', ['bg', 'surface', 'surface-2', 'surface-3'], TEXT],
  ['danger', ['bg', 'surface', 'surface-2'], TEXT],
  ['success', ['bg', 'surface', 'surface-2'], TEXT],
  ['warning', ['bg', 'surface', 'surface-2'], TEXT],
  ['info', ['bg', 'surface', 'surface-2'], TEXT],
  ['accent-ink', ['accent'], TEXT],
  ['border-strong', ['bg', 'surface'], UI],
  ['focus', ['bg', 'surface'], UI],
];

const themes = parseThemes(css);
const names = ['graphite', 'paper', 'contrast'];
let failures = 0;
for (const name of names) {
  const t = { ...themes[name] };
  for (const [fg, bgs, min] of PAIRS) {
    for (const bg of bgs) {
      if (!t[fg] || !t[bg]) {
        console.log(`MISSING  ${name}: --${fg} or --${bg}`);
        failures += 1;
        continue;
      }
      const r = ratio(t[fg], t[bg]);
      const ok = r >= min;
      if (!ok) failures += 1;
      if (!ok || process.argv.includes('--verbose')) {
        console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(9)} --${fg} on --${bg}: ${r.toFixed(2)} (need ${min})`);
      }
    }
  }
}
// Monaco editor themes (src/editor/themes.ts): every token colour and the line numbers sit on the editor background.
const themeSource = readFileSync(join(root, 'src/editor/themes.ts'), 'utf8');
let editorChecks = 0;
for (const block of themeSource.matchAll(/'nexus-(\w+)':\s*\{([\s\S]*?)\n  \},/g)) {
  const [, name, body] = block;
  const bg = /'editor\.background':\s*'(#[0-9a-fA-F]{6})'/.exec(body)?.[1];
  const colours = [
    ['editor.foreground', /'editor\.foreground':\s*'(#[0-9a-fA-F]{6})'/.exec(body)?.[1]],
    ['line numbers', /'editorLineNumber\.foreground':\s*'(#[0-9a-fA-F]{6})'/.exec(body)?.[1]],
    ['active line number', /'editorLineNumber\.activeForeground':\s*'(#[0-9a-fA-F]{6})'/.exec(body)?.[1]],
    ...[...body.matchAll(/\['([\w.]+)',\s*'([0-9a-fA-F]{6})'/g)].map(m => [`token ${m[1]}`, `#${m[2]}`]),
  ];
  for (const [label, colour] of colours) {
    if (!bg || !colour) {
      console.log(`MISSING  editor ${name}: ${label}`);
      failures += 1;
      continue;
    }
    editorChecks += 1;
    const r = ratio(colour, bg);
    if (r < TEXT) {
      failures += 1;
      console.log(`FAIL  editor ${name.padEnd(9)} ${label} ${colour} on ${bg}: ${r.toFixed(2)} (need ${TEXT})`);
    }
  }
}
const checked = names.length * PAIRS.reduce((n, [, bgs]) => n + bgs.length, 0) + editorChecks;
console.log(
  `${checked - failures}/${checked} contrast checks passed (${names.join(', ')} UI tokens + ${editorChecks} editor colours).`
);
process.exit(failures === 0 ? 0 : 1);
