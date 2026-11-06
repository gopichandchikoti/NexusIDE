// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, SandboxEvent } from './protocol';
import { createSandbox, sandboxUrl, type Sandbox } from './sandboxHost';

const msg = (n: number): HostMessage => ({ source: 'nexus-host', type: 'run-worker', code: `// ${n}` });
const fromFrame = (sandbox: Sandbox, data: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data, source: sandbox.frame.contentWindow }));

let mount: HTMLElement;
let events: SandboxEvent[];
let sandbox: Sandbox;
let sent: HostMessage[];

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  events = [];
  sandbox = createSandbox(mount, e => events.push(e), { visible: false, title: 'test frame' });
  sent = [];
  vi.spyOn(sandbox.frame.contentWindow as Window, 'postMessage').mockImplementation(((m: HostMessage) =>
    sent.push(m)) as never);
});
afterEach(() => {
  sandbox.destroy();
  mount.remove();
  vi.restoreAllMocks();
});

describe('createSandbox', () => {
  it('creates an iframe with the least-privilege flags and no feature permissions', () => {
    const frame = sandbox.frame;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(frame.getAttribute('allow')).toBe('');
    expect(frame.getAttribute('title')).toBe('test frame');
    expect(frame.referrerPolicy).toBe('no-referrer');
    expect(frame.className).toContain('sandbox-frame--hidden');
    expect(frame.src).toMatch(/sandbox\.html\?v=/);
    expect(frame.isConnected).toBe(true);
  });

  it('queues messages until the frame says ready, then delivers them in order', () => {
    sandbox.post(msg(1));
    sandbox.post(msg(2));
    expect(sent).toHaveLength(0);
    fromFrame(sandbox, { source: 'nexus-sandbox', type: 'ready' });
    expect(sent).toEqual([msg(1), msg(2)]);
    sandbox.post(msg(3));
    expect(sent.at(-1)).toEqual(msg(3));
    expect(events).toEqual([{ type: 'ready' }]);
  });

  it('caps the queue so a stuck frame cannot accumulate unbounded messages', () => {
    for (let i = 0; i < 20; i++) sandbox.post(msg(i));
    fromFrame(sandbox, { source: 'nexus-sandbox', type: 'ready' });
    expect(sent).toHaveLength(8);
  });

  it('ignores messages from other windows and malformed messages', () => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'nexus-sandbox', type: 'ready' }, source: window })
    );
    fromFrame(sandbox, { source: 'something-else', type: 'ready' });
    fromFrame(sandbox, 'ready');
    fromFrame(sandbox, { source: 'nexus-sandbox', type: 'console', level: 'nope', text: 'x' });
    expect(events).toEqual([]);
    fromFrame(sandbox, { source: 'nexus-sandbox', type: 'console', level: 'log', text: 'ok' });
    expect(events).toEqual([{ type: 'console', level: 'log', text: 'ok' }]);
  });

  it('removes the frame on destroy, ignores later messages, and is idempotent', () => {
    const frame = sandbox.frame;
    const win = frame.contentWindow;
    sandbox.destroy();
    expect(frame.isConnected).toBe(false);
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'nexus-sandbox', type: 'ready' }, source: win })
    );
    expect(events).toEqual([]);
    sandbox.post(msg(1));
    expect(sent).toEqual([]);
    expect(() => sandbox.destroy()).not.toThrow();
  });
});

describe('sandboxUrl', () => {
  it('resolves relative to the page and carries the content-hash version', () => {
    const url = new URL(sandboxUrl('https://example.test/ide/'));
    expect(url.origin + url.pathname).toBe('https://example.test/ide/sandbox.html');
    expect(url.searchParams.get('v')).toMatch(/^[0-9a-f]{10}$/);
  });
});
