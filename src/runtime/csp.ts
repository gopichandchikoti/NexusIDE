/**
 * Policy for user code. It is applied by `public/sandbox.html` (a test asserts the two stay identical)
 * and again as a <meta> in every generated preview document.
 *
 * - `connect-src 'none'`  : no fetch / XHR / WebSocket / EventSource / sendBeacon, in the page and in Workers
 *                           (blob: Workers inherit their creator's policy).
 * - `img-src data: blob:` : no image-beacon exfiltration.
 * - `frame-src 'none'`    : the page cannot embed or open other documents.
 * - `form-action 'none'`  : forms can fire `submit` events but cannot navigate anywhere.
 * 'unsafe-inline' / 'unsafe-eval' are required to run user code at all; the iframe `sandbox` attribute
 * (opaque origin, no same-origin, no top navigation, no popups) is what contains it.
 */
export const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  'worker-src blob:',
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** No `allow-same-origin`, `allow-top-navigation`, `allow-popups`, `allow-modals` or `allow-downloads`. */
export const SANDBOX_FLAGS = 'allow-scripts allow-forms';

/** Policy for the NexusIDE application shell itself (served as a header in production, see public/_headers). */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
