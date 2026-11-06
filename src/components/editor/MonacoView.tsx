import { useEffect, useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { resolveEditorTheme, resolveTheme } from '@/domain/settings';
import { setEditorBridge } from '@/editor/bridge';
import { ModelRegistry } from '@/editor/models';
import { setupMonaco } from '@/editor/monacoSetup';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { usePrefersDark, useReducedMotion } from '@/hooks/useMedia';

let registry: ModelRegistry | null = null;

/** Models outlive the editor widget (switching to the welcome screen must not lose undo history). */
function ensureRegistry(monaco: typeof Monaco): ModelRegistry {
  if (!registry) {
    registry = new ModelRegistry(monaco);
    registry.start();
  }
  return registry;
}

function useEditorOptions(): Monaco.editor.IEditorOptions {
  const fontSize = useSettingsStore(s => s.fontSize);
  const wordWrap = useSettingsStore(s => s.wordWrap);
  const minimap = useSettingsStore(s => s.minimap);
  const lineNumbers = useSettingsStore(s => s.lineNumbers);
  const motion = useSettingsStore(s => s.motion);
  const reduced = useReducedMotion(motion);
  return useMemo(
    () => ({
      fontSize,
      wordWrap: wordWrap ? 'on' : 'off',
      minimap: { enabled: minimap },
      lineNumbers: lineNumbers ? 'on' : 'off',
      smoothScrolling: !reduced,
      cursorSmoothCaretAnimation: reduced ? 'off' : 'on',
      cursorBlinking: reduced ? 'solid' : 'smooth',
    }),
    [fontSize, wordWrap, minimap, lineNumbers, reduced]
  );
}

const BASE_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontFamily: "'JetBrains Mono Variable', ui-monospace, Consolas, monospace",
  fontLigatures: false,
  insertSpaces: true,
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  padding: { top: 12, bottom: 12 },
  bracketPairColorization: { enabled: true },
  accessibilitySupport: 'auto',
  ariaLabel: 'Code editor. Press Ctrl+M to toggle Tab key focus movement.',
  fixedOverflowWidgets: true,
};

export default function MonacoView() {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const viewStates = useRef(new Map<string, Monaco.editor.ICodeEditorViewState | null>());
  const shownId = useRef<string | null>(null);
  const active = useEditorStore(s => s.active);
  const structure = useWorkspaceStore(s => s.structure);
  const options = useEditorOptions();
  const tabSize = useSettingsStore(s => s.tabSize);
  const themeChoice = useSettingsStore(s => s.theme);
  const editorTheme = useSettingsStore(s => s.editorTheme);
  const prefersDark = usePrefersDark();

  useEffect(() => {
    const monaco = setupMonaco();
    ensureRegistry(monaco);
    const editor = monaco.editor.create(host.current as HTMLElement, { ...BASE_OPTIONS, model: null });
    editorRef.current = editor;
    setEditorBridge({ editor });
    const cursor = editor.onDidChangeCursorPosition(e =>
      useEditorStore.getState().setCursor({ line: e.position.lineNumber, column: e.position.column })
    );
    const states = viewStates.current;
    return () => {
      const id = shownId.current;
      if (id) states.set(id, editor.saveViewState());
      cursor.dispose();
      setEditorBridge(null);
      editor.dispose();
      editorRef.current = null;
      shownId.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !registry) return;
    if (shownId.current) viewStates.current.set(shownId.current, editor.saveViewState());
    const model = active ? registry.get(active) : null;
    model?.updateOptions({ tabSize, insertSpaces: true });
    editor.setModel(model);
    shownId.current = model ? active : null;
    const saved = active ? viewStates.current.get(active) : null;
    if (saved) editor.restoreViewState(saved);
    if (model) editor.focus();
  }, [active, structure, tabSize]);

  useEffect(() => {
    editorRef.current?.updateOptions(options);
  }, [options]);

  useEffect(() => {
    const monaco = setupMonaco();
    const name = resolveEditorTheme(editorTheme, resolveTheme(themeChoice, prefersDark));
    monaco.editor.setTheme(name);
  }, [themeChoice, editorTheme, prefersDark]);

  const reveal = useEditorStore(s => s.reveal);
  useEffect(() => {
    const editor = editorRef.current;
    if (!reveal || !editor || reveal.fileId !== active || shownId.current !== active) return;
    editor.revealLineInCenter(reveal.line);
    editor.setPosition({ lineNumber: reveal.line, column: reveal.column });
    editor.focus();
    useEditorStore.getState().clearReveal();
  }, [reveal, active, structure]);

  return <div ref={host} className="monaco-host" data-testid="monaco-host" />;
}
