// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxEvent } from '@/runtime/protocol';
import { useUiStore } from '@/store/uiStore';

let emit: ((e: SandboxEvent) => void) | null = null;
let destroyed = false;
vi.mock('@/runtime/sandboxHost', () => ({
  createSandbox: (_m: HTMLElement, onEvent: (e: SandboxEvent) => void) => {
    emit = onEvent;
    return {
      frame: {},
      post: () => undefined,
      destroy: () => {
        destroyed = true;
      },
    };
  },
}));

const { warmSandboxCache, scheduleSandboxWarmUp } = await import('./warm');
const { registerServiceWorker } = await import('./register');

beforeEach(() => {
  emit = null;
  destroyed = false;
  delete document.documentElement.dataset.sandboxWarm;
  document.body.innerHTML = '';
  useUiStore.setState({ toasts: [] });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sandbox warm-up', () => {
  it('does nothing without a mount point', () => {
    warmSandboxCache();
    expect(emit).toBeNull();
  });

  it('loads the sandbox once, marks the document when ready, then discards the frame', () => {
    document.body.innerHTML = '<div id="sandbox-host"></div>';
    warmSandboxCache();
    emit?.({ type: 'console', level: 'log', text: 'ignored' });
    expect(document.documentElement.dataset.sandboxWarm).toBeUndefined();
    emit?.({ type: 'ready' });
    expect(document.documentElement.dataset.sandboxWarm).toBe('true');
    expect(destroyed).toBe(true);
  });

  it('only schedules in production builds', () => {
    document.body.innerHTML = '<div id="sandbox-host"></div>';
    scheduleSandboxWarmUp();
    expect(emit).toBeNull();
    vi.stubEnv('PROD', true);
    vi.useFakeTimers();
    Reflect.deleteProperty(window, 'requestIdleCallback');
    scheduleSandboxWarmUp();
    vi.advanceTimersByTime(2000);
    expect(emit).not.toBeNull();
    vi.useRealTimers();
  });
});

describe('service worker registration', () => {
  function stubServiceWorker() {
    const listeners: Record<string, Array<() => void>> = {};
    const worker = {
      state: 'installing',
      postMessage: vi.fn(),
      addEventListener: (t: string, cb: () => void) => (listeners[t] ??= []).push(cb),
    };
    const registration = {
      installing: worker,
      addEventListener: (t: string, cb: () => void) => (listeners[`reg:${t}`] ??= []).push(cb),
    };
    const container = {
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: (t: string, cb: () => void) => (listeners[`sw:${t}`] ??= []).push(cb),
    };
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    return { listeners, worker, container };
  }

  it('does nothing outside production', () => {
    const { container } = stubServiceWorker();
    registerServiceWorker();
    window.dispatchEvent(new Event('load'));
    expect(container.register).not.toHaveBeenCalled();
  });

  it('registers on load and offers a reload (never auto-reloads) when a new build is installed', async () => {
    vi.stubEnv('PROD', true);
    const { listeners, worker, container } = stubServiceWorker();
    registerServiceWorker();
    window.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(container.register).toHaveBeenCalledWith('./sw.js'));
    await vi.waitFor(() => expect(listeners['reg:updatefound']).toBeDefined());
    listeners['reg:updatefound']?.forEach(cb => cb());
    worker.state = 'installed';
    listeners['statechange']?.forEach(cb => cb());
    const toast = useUiStore.getState().toasts.at(-1);
    expect(toast?.message).toContain('new version');
    toast?.action?.run();
    expect(worker.postMessage).toHaveBeenCalledWith('skip-waiting');
  });
});
