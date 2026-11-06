import { SANDBOX_FLAGS } from './csp';
import { parseSandboxEvent, type HostMessage, type SandboxEvent } from './protocol';

export interface Sandbox {
  readonly frame: HTMLIFrameElement;
  post(message: HostMessage): void;
  destroy(): void;
}

export interface SandboxOptions {
  readonly visible: boolean;
  readonly title: string;
}

const MAX_QUEUED = 8;

/** Versioned by content hash so the browser can keep it in its HTTP cache for a year (and so offline runs work). */
export function sandboxUrl(base: string = document.baseURI): string {
  const url = new URL('sandbox.html', base);
  url.searchParams.set('v', __SANDBOX_VERSION__);
  return url.href;
}

/**
 * Creates one sandboxed iframe for one run. The frame has an opaque origin (no `allow-same-origin`), so it cannot
 * read this app's IndexedDB, localStorage or cookies, and it is destroyed after the run. Messages are accepted
 * only from this frame's own window and only if they pass `parseSandboxEvent`.
 */
export function createSandbox(
  mount: HTMLElement,
  onEvent: (event: SandboxEvent) => void,
  options: SandboxOptions
): Sandbox {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', SANDBOX_FLAGS);
  frame.setAttribute('allow', '');
  frame.setAttribute('title', options.title);
  frame.referrerPolicy = 'no-referrer';
  frame.className = options.visible ? 'sandbox-frame' : 'sandbox-frame sandbox-frame--hidden';
  const queue: HostMessage[] = [];
  let ready = false;
  let destroyed = false;

  const send = (message: HostMessage): void => frame.contentWindow?.postMessage(message, '*');
  const listener = (event: MessageEvent): void => {
    if (destroyed || event.source !== frame.contentWindow) return;
    const parsed = parseSandboxEvent(event.data);
    if (!parsed) return;
    if (parsed.type === 'ready') {
      ready = true;
      queue.splice(0).forEach(send);
    }
    onEvent(parsed);
  };
  window.addEventListener('message', listener);
  frame.src = sandboxUrl();
  mount.appendChild(frame);

  return {
    frame,
    post(message) {
      if (destroyed) return;
      if (ready) send(message);
      else if (queue.length < MAX_QUEUED) queue.push(message);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('message', listener);
      frame.src = 'about:blank';
      frame.remove();
    },
  };
}
