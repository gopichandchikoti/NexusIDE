import { useMemo, useState } from 'react';
import { buildCommands } from '@/app/commands';
import { formatChord, isMacPlatform } from '@/app/keymap';
import { startFromTemplate } from '@/app/workspaceActions';
import { TEMPLATES } from '@/data/templates';
import { useUiStore } from '@/store/uiStore';
import { Modal } from '../ui/Modal';
import { Kbd } from '../ui/primitives';

export function ShortcutsDialog() {
  const open = useUiStore(s => s.shortcutsOpen);
  const [filter, setFilter] = useState('');
  const mac = isMacPlatform();
  const rows = useMemo(() => buildCommands().filter(c => c.keys), []);
  const shown = rows.filter(c => `${c.category} ${c.title}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Modal
      open={open}
      title="Keyboard shortcuts"
      onClose={() => useUiStore.getState().setDialog({ shortcutsOpen: false })}
      width={620}
    >
      <label htmlFor="shortcut-filter" className="field__label">
        Filter
      </label>
      <input
        id="shortcut-filter"
        className="field__input"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="e.g. save"
        autoComplete="off"
      />
      <table className="shortcuts">
        <thead>
          <tr>
            <th scope="col">Area</th>
            <th scope="col">Command</th>
            <th scope="col">Keys</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(c => (
            <tr key={c.id}>
              <td>{c.category}</td>
              <td>{c.title}</td>
              <td>
                <Kbd>{formatChord(c.keys as string, mac)}</Kbd>
                {c.alsoKeys?.map(k => (
                  <span key={k}>
                    {' '}
                    or <Kbd>{formatChord(k, mac)}</Kbd>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="setting__note">
        Inside the editor, the usual Monaco keys also work: {formatChord('Mod+F', mac)} find,{' '}
        {formatChord('Mod+D', mac)} select next match, {formatChord('Alt+Up', mac)} move line. To move keyboard focus
        out of the editor with Tab, press {formatChord('Mod+M', mac)} first.
      </p>
    </Modal>
  );
}

export function TemplatesDialog() {
  const open = useUiStore(s => s.templatesOpen);
  const close = (): void => useUiStore.getState().setDialog({ templatesOpen: false });
  return (
    <Modal open={open} title="Start from a template" onClose={close} width={640}>
      <ul className="templates templates--dialog">
        {TEMPLATES.map(t => (
          <li key={t.id}>
            <button
              type="button"
              className="template"
              onClick={() => {
                close();
                startFromTemplate(t.id);
              }}
            >
              <span className="template__name">{t.name}</span>
              <span className="template__summary">{t.summary}</span>
              {t.tags.length > 0 && <span className="template__meta">{t.tags.join(' · ')}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
