// Only what NexusIDE offers is bundled (not the ~80 grammars of the full 'monaco-editor' entry point).
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { EDITOR_THEMES } from './themes';
import { REACT_TYPINGS } from './reactTypes';

/**
 * Monaco is bundled and served from this origin (no CDN), so the editor works offline once the app is loaded.
 * Language services run in Web Workers created from this same origin.
 */
function configureWorkers(): void {
  self.MonacoEnvironment = {
    getWorker(_id: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };
}

function configureTypeScript(): void {
  const ts = monaco.languages.typescript;
  const options: monaco.languages.typescript.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
  };
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setCompilerOptions(options);
    defaults.setEagerModelSync(true);
    defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    defaults.addExtraLib(REACT_TYPINGS, 'file:///node_modules/@types/react/index.d.ts');
  }
}

function defineThemes(): void {
  for (const [name, spec] of Object.entries(EDITOR_THEMES)) {
    monaco.editor.defineTheme(name, {
      base: spec.base,
      inherit: true,
      colors: { ...spec.colors },
      rules: spec.tokens.map(([token, foreground, fontStyle]) => ({ token, foreground, fontStyle })),
    });
  }
}

let configured = false;

/** Idempotent. Call before creating an editor. */
export function setupMonaco(): typeof monaco {
  if (!configured) {
    configured = true;
    configureWorkers();
    configureTypeScript();
    defineThemes();
  }
  return monaco;
}

export { monaco };
