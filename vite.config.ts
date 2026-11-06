import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildServiceWorker, isPrecached } from './src/pwa/precache';

/** Production builds carry the app CSP inline too, so a host that cannot set headers is still protected. */
function appCsp(): Plugin {
  const policy =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; " +
    "base-uri 'self'; form-action 'none'";
  return {
    name: 'nexuside-app-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]
  );
}

/**
 * Writes dist/sw.js: a service worker that precaches exactly the files of this build, so the app, editor, terminal
 * and sandbox page keep working offline. The version is a hash of the file contents, so a new build is a new worker.
 */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'nexuside-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = listFiles(outDir)
        .map(f => relative(outDir, f).replace(/\\/g, '/'))
        .filter(isPrecached)
        .sort();
      const hash = createHash('sha256');
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)));
      const template = readFileSync(resolve(__dirname, 'scripts/sw.template.js'), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), buildServiceWorker(hash.digest('hex').slice(0, 12), files, template));
    },
  };
}
/** Versions the sandbox URL: its content hash changes only when sandbox.html does. */
const SANDBOX_VERSION = createHash('sha256')
  .update(readFileSync(resolve(__dirname, 'public/sandbox.html')))
  .digest('hex')
  .slice(0, 10);

/** sandbox.html is requested by an opaque-origin frame, which no service worker can serve, so the HTTP cache must. */
function sandboxCache(): Plugin {
  return {
    name: 'nexuside-sandbox-cache',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0]?.endsWith('/sandbox.html')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __SANDBOX_VERSION__: JSON.stringify(SANDBOX_VERSION) },
  plugins: [react(), appCsp(), serviceWorker(), sandboxCache()],
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**', 'src/vite-env.d.ts', 'src/main.tsx'],
      // Gates apply to the logic layers. React components are covered by the browser suites (e2e/), which do not
      // produce V8 coverage, so no unit gate is claimed for them (see docs/TEST_REPORT.md for the measured numbers).
      thresholds: {
        'src/domain/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'src/{runtime,store,services,pwa}/**': { statements: 90, branches: 85, functions: 85, lines: 90 },
        'src/app/**': { statements: 85, branches: 80, functions: 75, lines: 85 },
      },
    },
  },
});
