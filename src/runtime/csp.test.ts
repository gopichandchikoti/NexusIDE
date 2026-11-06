// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SANDBOX_CSP, SANDBOX_FLAGS } from './csp';
import { sandboxUrl } from './sandboxHost';

const html = readFileSync(join(process.cwd(), 'public', 'sandbox.html'), 'utf8');

describe('sandbox policy', () => {
  it('public/sandbox.html carries exactly the policy defined in csp.ts', () => {
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
    expect(meta).toBe(SANDBOX_CSP);
  });

  it('forbids every network and navigation channel the sandbox does not need', () => {
    for (const directive of [
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "default-src 'none'",
    ]) {
      expect(SANDBOX_CSP).toContain(directive);
    }
    expect(SANDBOX_CSP).not.toMatch(/https?:|\*/);
  });

  it('never grants same-origin, top navigation, popups, modals or downloads to the frame', () => {
    const flags = SANDBOX_FLAGS.split(' ');
    expect(flags).toEqual(['allow-scripts', 'allow-forms']);
    for (const forbidden of [
      'allow-same-origin',
      'allow-top-navigation',
      'allow-popups',
      'allow-modals',
      'allow-downloads',
    ]) {
      expect(flags).not.toContain(forbidden);
    }
  });

  it('is one self-contained document: a single inline loader, no external resources', () => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('event.source !== parent');
  });

  it('versions the URL so it can be cached as immutable', () => {
    const url = new URL(sandboxUrl('http://localhost:4173/app/'));
    expect(url.pathname).toBe('/app/sandbox.html');
    expect(url.searchParams.get('v')).toMatch(/^[0-9a-f]{10}$/);
  });
});
