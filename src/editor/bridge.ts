import type * as Monaco from 'monaco-editor';

/**
 * The one place commands (palette, shortcuts) reach the live editor instance.
 * Set by MonacoView when it mounts, cleared when it unmounts.
 */
export interface EditorBridge {
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
}

let current: EditorBridge | null = null;

export function setEditorBridge(bridge: EditorBridge | null): void {
  current = bridge;
}

export function getEditor(): Monaco.editor.IStandaloneCodeEditor | null {
  return current?.editor ?? null;
}

export async function runEditorAction(id: string): Promise<boolean> {
  const action = current?.editor.getAction(id);
  if (!action) return false;
  await action.run();
  return true;
}
