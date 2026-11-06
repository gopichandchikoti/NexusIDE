import { useEffect, useId, useMemo, useState } from 'react';
import { CaseSensitive, Regex, WholeWord } from 'lucide-react';
import { searchWorkspace, type SearchHit, type SearchOptions, type SearchOutcome } from '@/domain/search';
import type { AppError } from '@/domain/errors';
import { useEditorStore } from '@/store/editorStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { IconButton } from '../ui/primitives';

const DEBOUNCE_MS = 220;

function groupByFile(hits: readonly SearchHit[]): Array<[string, SearchHit[]]> {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) groups.set(hit.path, [...(groups.get(hit.path) ?? []), hit]);
  return [...groups.entries()];
}

function Preview({ hit }: { readonly hit: SearchHit }) {
  return (
    <span className="hit__text">
      {hit.preview.slice(0, hit.start)}
      <mark>{hit.preview.slice(hit.start, hit.end)}</mark>
      {hit.preview.slice(hit.end)}
    </span>
  );
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const inputId = useId();
  const fs = useWorkspaceStore(s => s.fs);
  const options = useMemo<SearchOptions>(
    () => ({ query, caseSensitive, wholeWord, regex }),
    [query, caseSensitive, wholeWord, regex]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      const result = searchWorkspace(fs, options);
      setError(result.ok ? null : result.error);
      setOutcome(result.ok ? result.value : null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fs, options]);

  const groups = outcome ? groupByFile(outcome.hits) : [];
  return (
    <section className="search" aria-label="Search">
      <div className="search__box">
        <label htmlFor={inputId} className="sr-only">
          Search in all files
        </label>
        <input
          id={inputId}
          type="search"
          className="field__input"
          placeholder="Search in all files"
          value={query}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null}
          onChange={event => setQuery(event.target.value)}
        />
        <div className="search__toggles" role="group" aria-label="Search options">
          <IconButton
            icon={CaseSensitive}
            label="Match case"
            pressed={caseSensitive}
            onClick={() => setCaseSensitive(v => !v)}
          />
          <IconButton
            icon={WholeWord}
            label="Match whole word"
            pressed={wholeWord}
            onClick={() => setWholeWord(v => !v)}
          />
          <IconButton icon={Regex} label="Use regular expression" pressed={regex} onClick={() => setRegex(v => !v)} />
        </div>
      </div>
      <SearchStatus error={error} outcome={query === '' ? null : outcome} />
      <SearchResults groups={groups} />
    </section>
  );
}

function summary(outcome: SearchOutcome): string {
  if (outcome.hits.length === 0) return 'No results.';
  const more = outcome.truncated ? '+' : '';
  const note = outcome.truncated ? ' (showing the first matches)' : '';
  return `${outcome.hits.length}${more} results in ${outcome.filesMatched} files${note}.`;
}

function SearchStatus({ error, outcome }: { readonly error: AppError | null; readonly outcome: SearchOutcome | null }) {
  return (
    <div className="search__status" role="status" aria-live="polite">
      {error && <span className="field__error">{error.message}</span>}
      {!error && outcome && <span>{summary(outcome)}</span>}
    </div>
  );
}

function SearchResults({ groups }: { readonly groups: Array<[string, SearchHit[]]> }) {
  return (
    <div className="search__results">
      {groups.map(([path, hits]) => (
        <div key={path} className="hits">
          <h3 className="hits__file">
            {path} <span className="hits__count">{hits.length}</span>
          </h3>
          <ul>
            {hits.map(hit => (
              <li key={`${hit.line}:${hit.start}`}>
                <button
                  type="button"
                  className="hit"
                  onClick={() => useEditorStore.getState().requestReveal(hit.fileId, hit.line, 1)}
                >
                  <span className="hit__line">{hit.line}</span>
                  <Preview hit={hit} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
