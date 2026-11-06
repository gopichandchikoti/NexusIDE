import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildCommands } from '@/app/commands';
import { formatChord, isMacPlatform } from '@/app/keymap';
import { pathOf, toEntries } from '@/domain/fs';
import { rank, type Ranked } from '@/domain/fuzzy';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { Kbd } from '../ui/primitives';

interface Item {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly keys?: string;
  readonly run: () => void | Promise<void>;
}

function itemsFor(mode: 'commands' | 'files'): Item[] {
  if (mode === 'commands') {
    return buildCommands().map(c => ({ id: c.id, label: c.title, detail: c.category, keys: c.keys, run: c.run }));
  }
  const { fs } = useWorkspaceStore.getState();
  const open = useEditorStore.getState().tabs;
  const paths = toEntries(fs).filter(e => e.kind === 'file');
  const idByPath = new Map(Object.values(fs).map(n => [pathOf(fs, n.id), n.id]));
  const ordered = [...paths].sort(
    (a, b) => Number(open.includes(idByPath.get(b.path) ?? '')) - Number(open.includes(idByPath.get(a.path) ?? ''))
  );
  return ordered.map(p => ({
    id: p.path,
    label: p.path.split('/').pop() ?? p.path,
    detail: p.path,
    run: () => {
      const id = idByPath.get(p.path);
      if (id) useEditorStore.getState().openFile(id);
    },
  }));
}

function Highlight({ text, indices }: { readonly text: string; readonly indices: readonly number[] }) {
  const set = new Set(indices);
  return <>{[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>;
}

interface ListProps {
  readonly id: string;
  readonly results: readonly Ranked<Item>[];
  readonly index: number;
  readonly mode: 'commands' | 'files';
  readonly highlight: boolean;
  readonly onHover: (index: number) => void;
  readonly onChoose: (item: Item) => void;
}

/** Match indices refer to "<detail> <label>", so shift them to the label before highlighting. */
function labelIndices(r: Ranked<Item>, mode: 'commands' | 'files', highlight: boolean): number[] {
  if (!highlight || mode !== 'commands') return [];
  const offset = (r.item.detail?.length ?? 0) + 1;
  return r.match.indices.map(x => x - offset).filter(x => x >= 0);
}

function PaletteList({ id, results, index, mode, highlight, onHover, onChoose }: ListProps) {
  const mac = isMacPlatform();
  return (
    <ul id={id} className="palette__list" role="listbox" aria-label="Results">
      {results.map((r, i) => (
        <li
          key={r.item.id}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === index}
          className={`palette__item${i === index ? ' is-active' : ''}`}
          onMouseMove={() => onHover(i)}
          onMouseDown={event => {
            event.preventDefault();
            onChoose(r.item);
          }}
        >
          <span className="palette__label">
            <Highlight text={r.item.label} indices={labelIndices(r, mode, highlight)} />
          </span>
          {r.item.detail && <span className="palette__detail">{r.item.detail}</span>}
          {r.item.keys && <Kbd>{formatChord(r.item.keys, mac)}</Kbd>}
        </li>
      ))}
      {results.length === 0 && (
        <li className="palette__empty" role="option" aria-selected="false" aria-disabled="true">
          {mode === 'files' ? 'No matching files.' : 'No matching commands.'}
        </li>
      )}
    </ul>
  );
}

function textOf(item: Item, mode: 'commands' | 'files'): string {
  return mode === 'files' ? (item.detail ?? item.label) : `${item.detail ?? ''} ${item.label}`;
}

export function CommandPalette() {
  const mode = useUiStore(s => s.palette);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const items = useMemo(() => (mode ? itemsFor(mode) : []), [mode]);
  const results = useMemo(() => rank(items, query, i => textOf(i, mode ?? 'commands')), [items, query, mode]);

  useEffect(() => {
    if (!mode) return;
    setQuery('');
    setIndex(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [mode]);

  useEffect(() => setIndex(0), [query]);

  if (!mode) return null;
  const close = (): void => useUiStore.getState().closePalette();
  const choose = (item: Item | undefined): void => {
    if (!item) return;
    close();
    // Let the palette unmount (and restore focus) before the command moves focus elsewhere.
    setTimeout(() => void item.run(), 0);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') setIndex(i => Math.min(results.length - 1, i + 1));
    else if (event.key === 'ArrowUp') setIndex(i => Math.max(0, i - 1));
    else if (event.key === 'Enter') choose(results[index]?.item);
    else if (event.key === 'Escape') close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div className="scrim scrim--top" onMouseDown={event => event.target === event.currentTarget && close()}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'files' ? 'Go to file' : 'Command palette'}
      >
        <input
          ref={input}
          className="palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[index] ? `${listId}-${index}` : undefined}
          aria-autocomplete="list"
          placeholder={mode === 'files' ? 'Type a file name' : 'Type a command'}
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <PaletteList
          id={listId}
          results={results}
          index={index}
          mode={mode}
          highlight={query !== ''}
          onHover={setIndex}
          onChoose={choose}
        />
        <p className="sr-only" role="status" aria-live="polite">
          {results.length} results
        </p>
      </div>
    </div>
  );
}
