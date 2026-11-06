import type { MonacoThemeName } from '@/domain/settings';

export interface ThemeSpec {
  readonly base: 'vs' | 'vs-dark' | 'hc-black';
  readonly colors: Readonly<Record<string, string>>;
  readonly tokens: ReadonlyArray<readonly [token: string, foreground: string, style?: string]>;
}

/** Editor themes that follow the app palettes in src/styles/tokens.css (hex only; Monaco requires it). */
export const EDITOR_THEMES: Readonly<Record<MonacoThemeName, ThemeSpec>> = {
  'nexus-graphite': {
    base: 'vs-dark',
    colors: {
      'editor.background': '#16191e',
      'editor.foreground': '#ebe8e1',
      'editor.lineHighlightBackground': '#1d2127',
      'editor.selectionBackground': '#f2a65a40',
      'editorCursor.foreground': '#f2a65a',
      'editorLineNumber.foreground': '#8b919b',
      'editorLineNumber.activeForeground': '#ebe8e1',
      'editorIndentGuide.background1': '#2a2f37',
      'editorWhitespace.foreground': '#2e333b',
    },
    tokens: [
      ['comment', '858c97', 'italic'],
      ['keyword', 'f2a65a'],
      ['string', 'a3d9a0'],
      ['number', '79b8ff'],
      ['type', '7fd1c8'],
      ['tag', 'f2a65a'],
      ['attribute.name', '7fd1c8'],
      ['delimiter', 'b8bcc4'],
    ],
  },
  'nexus-paper': {
    base: 'vs',
    colors: {
      'editor.background': '#f9f6ef',
      'editor.foreground': '#211f1a',
      'editor.lineHighlightBackground': '#f0eadc',
      'editor.selectionBackground': '#9a3f0830',
      'editorCursor.foreground': '#9a3f08',
      'editorLineNumber.foreground': '#6b665b',
      'editorLineNumber.activeForeground': '#211f1a',
      'editorIndentGuide.background1': '#e1d9c7',
    },
    tokens: [
      ['comment', '6b665b', 'italic'],
      ['keyword', '9a3f08'],
      ['string', '156a3c'],
      ['number', '0b5cad'],
      ['type', '006d77'],
      ['tag', '9a3f08'],
      ['attribute.name', '006d77'],
    ],
  },
  'nexus-contrast': {
    base: 'hc-black',
    colors: {
      'editor.background': '#000000',
      'editor.foreground': '#ffffff',
      'editorCursor.foreground': '#ffd54a',
      'editorLineNumber.foreground': '#d4d4d4',
      'editorLineNumber.activeForeground': '#ffffff',
    },
    tokens: [
      ['comment', 'd4d4d4', 'italic'],
      ['keyword', 'ffd54a'],
      ['string', '8affb4'],
      ['number', '8ec9ff'],
    ],
  },
  'nexus-midnight': {
    base: 'vs-dark',
    colors: {
      'editor.background': '#0e1420',
      'editor.foreground': '#dbe4f3',
      'editor.lineHighlightBackground': '#141c2c',
      'editor.selectionBackground': '#8ab4ff40',
      'editorCursor.foreground': '#8ab4ff',
      'editorLineNumber.foreground': '#8c9bb8',
      'editorLineNumber.activeForeground': '#dbe4f3',
    },
    tokens: [
      ['comment', '7083a6', 'italic'],
      ['keyword', '8ab4ff'],
      ['string', 'a5e0b3'],
      ['number', 'ffb86b'],
      ['type', '7fd1c8'],
      ['tag', '8ab4ff'],
    ],
  },
};
