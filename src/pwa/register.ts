import { useUiStore } from '@/store/uiStore';

/**
 * Registers the offline service worker (production builds only). When a new build has finished installing, the user
 * is offered a reload; the page never reloads by itself, so typing is never interrupted.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let reloadRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(registration => {
        registration.addEventListener('updatefound', () => {
          const incoming = registration.installing;
          incoming?.addEventListener('statechange', () => {
            if (incoming.state !== 'installed' || !navigator.serviceWorker.controller) return;
            useUiStore.getState().toast('info', 'A new version of NexusIDE is ready.', {
              label: 'Reload',
              run: () => {
                reloadRequested = true;
                incoming.postMessage('skip-waiting');
              },
            });
          });
        });
      })
      .catch(() => {
        // Offline support is an enhancement; the app works without it.
      });
  });
}
