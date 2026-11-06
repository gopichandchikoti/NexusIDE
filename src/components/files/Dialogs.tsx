import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { submitName } from '@/app/fileActions';
import { useUiStore, type NameDialog } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { Modal } from '../ui/Modal';

function titleFor(dialog: NameDialog): string {
  if (dialog.mode === 'rename') return 'Rename';
  return dialog.mode === 'file' ? 'New file' : 'New folder';
}

function NameForm({ dialog, onDone }: { readonly dialog: NameDialog; readonly onDone: () => void }) {
  const initial = dialog.mode === 'rename' ? (useWorkspaceStore.getState().fs[dialog.id]?.name ?? '') : '';
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const result = submitName(dialog, value);
    if (result.ok) onDone();
    else setError(result.error.message);
  };

  return (
    <form id="name-form" onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="field__label">
        {dialog.mode === 'folder' ? 'Folder name' : 'File name'}
      </label>
      <input
        id={inputId}
        ref={input}
        className="field__input"
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        placeholder={dialog.mode === 'folder' ? 'components' : 'index.html'}
        onChange={event => {
          setValue(event.target.value);
          setError(null);
        }}
      />
      {error && (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function NameDialogHost() {
  const dialog = useUiStore(s => s.nameDialog);
  const close = (): void => useUiStore.getState().openNameDialog(null);
  return (
    <Modal
      open={dialog !== null}
      title={dialog ? titleFor(dialog) : ''}
      onClose={close}
      width={420}
      initialFocus=".field__input"
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" form="name-form" className="btn btn--primary">
            {dialog?.mode === 'rename' ? 'Rename' : 'Create'}
          </button>
        </>
      }
    >
      {dialog && <NameForm key={JSON.stringify(dialog)} dialog={dialog} onDone={close} />}
    </Modal>
  );
}

export function ConfirmDialogHost() {
  const request = useUiStore(s => s.confirm);
  const close = (): void => useUiStore.getState().askConfirm(null);
  return (
    <Modal
      open={request !== null}
      title={request?.title ?? ''}
      onClose={close}
      width={440}
      initialFocus="[data-autofocus]"
      footer={
        <>
          <button type="button" className="btn" data-autofocus onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${request?.danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => {
              const run = request?.onConfirm;
              close();
              run?.();
            }}
          >
            {request?.confirmLabel}
          </button>
        </>
      }
    >
      <p>{request?.message}</p>
    </Modal>
  );
}
