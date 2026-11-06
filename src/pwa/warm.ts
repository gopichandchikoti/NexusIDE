import { createSandbox } from '@/runtime/sandboxHost';

/**
 * Loads the sandbox page once in a hidden frame (then discards it) so it is in the browser's HTTP cache. A service
 * worker cannot serve a sandboxed frame, so this is what lets "Run" work if the network drops before the first run.
 * Marks <html data-sandbox-warm> when done (used by the browser tests).
 */
export function warmSandboxCache(): void {
  const mount = document.getElementById('sandbox-host');
  if (!mount) return;
  const sandbox = createSandbox(
    mount,
    event => {
      if (event.type !== 'ready') return;
      document.documentElement.dataset.sandboxWarm = 'true';
      sandbox.destroy();
    },
    { visible: false, title: 'Sandbox warm-up' }
  );
}

export function scheduleSandboxWarmUp(): void {
  if (!import.meta.env.PROD) return;
  const run = (): void => warmSandboxCache();
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
