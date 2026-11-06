export type BridgeMode = 'document' | 'script' | 'repl';

/**
 * Plain-JS prelude that runs INSIDE the sandbox (page or Worker) before user code. It turns console output,
 * uncaught errors and (for Workers) "event loop is empty" into protocol messages. It is a string, not a function,
 * so no bundler helper can leak into it. Avoid backticks and dollar-brace sequences inside.
 */
const BRIDGE_BODY = String.raw`
var __IS_WORKER = typeof window === 'undefined';
var __g = __IS_WORKER ? self : window;
var __sent = 0, __CONSOLE_BUDGET = 5000;
function __raw(m) {
  m.source = 'nexus-sandbox';
  try { if (__IS_WORKER) { self.postMessage(m); } else { parent.postMessage(m, '*'); } } catch (e) {}
}
/* Output is capped here, at the source, so a print loop costs the host nothing past the budget. */
function __send(m) {
  if (m.type === 'console' && ++__sent > __CONSOLE_BUDGET) {
    if (__sent === __CONSOLE_BUDGET + 1) __raw({ type: 'console', level: 'warn', text: 'Output limit reached; further output is dropped.' });
    return;
  }
  __raw(m);
}
function __inspect(v, depth, seen) {
  var t = typeof v;
  if (v === null) return 'null';
  if (t === 'undefined') return 'undefined';
  if (t === 'string') return depth === 0 ? v : JSON.stringify(v);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v) + (t === 'bigint' ? 'n' : '');
  if (t === 'symbol') return v.toString();
  if (t === 'function') return '[Function' + (v.name ? ': ' + v.name : '') + ']';
  if (v instanceof Error) return v.stack ? String(v.stack) : String(v);
  if (seen.indexOf(v) !== -1) return '[Circular]';
  if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen = seen.concat([v]);
  try {
    if (Array.isArray(v)) {
      var items = v.slice(0, 100).map(function (x) { return __inspect(x, depth + 1, seen); });
      return '[' + items.join(', ') + (v.length > 100 ? ', … ' + (v.length - 100) + ' more' : '') + ']';
    }
    if (v instanceof Map) return 'Map(' + v.size + ') ' + __inspect(Array.from(v.entries()), depth + 1, seen);
    if (v instanceof Set) return 'Set(' + v.size + ') ' + __inspect(Array.from(v.values()), depth + 1, seen);
    if (v instanceof Date) return v.toISOString();
    if (v instanceof RegExp) return String(v);
    var keys = Object.keys(v).slice(0, 100);
    var ctor = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
    return ctor + '{' + keys.map(function (k) { return k + ': ' + __inspect(v[k], depth + 1, seen); }).join(', ') + '}';
  } catch (e) { return '[Unprintable]'; }
}
function __format(args) {
  return Array.prototype.map.call(args, function (a) { return __inspect(a, 0, []); }).join(' ');
}
['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
  console[level] = function () { __send({ type: 'console', level: level, text: __format(arguments) }); };
});
console.clear = function () {};
console.table = function (d) { __send({ type: 'console', level: 'log', text: __format([d]) }); };
__g.addEventListener('error', function (e) {
  __send({ type: 'error', message: e.message || 'Script error' });
  e.preventDefault();
});
__g.addEventListener('unhandledrejection', function (e) {
  __send({ type: 'error', message: 'Unhandled promise rejection: ' + __format([e.reason]) });
  e.preventDefault();
});
if (!__IS_WORKER) {
  __g.alert = function (m) { __send({ type: 'console', level: 'info', text: 'alert(): ' + __format([m]) }); };
  __g.confirm = function (m) { __send({ type: 'console', level: 'info', text: 'confirm(): ' + __format([m]) + ' -> false' }); return false; };
  __g.prompt = function (m) { __send({ type: 'console', level: 'info', text: 'prompt(): ' + __format([m]) + ' -> null' }); return null; };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    e.preventDefault();
    __send({ type: 'console', level: 'warn', text: 'Navigation blocked in the sandbox: ' + href });
  }, true);
  /* A submit the page did not handle itself is cancelled, and form.submit() is a no-op. Script navigation such as
     location.href cannot be intercepted from JavaScript; the host CSP (frame-src 'self') and the watchdog contain it. */
  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    __send({ type: 'console', level: 'warn', text: 'Form submission was blocked: pages in the sandbox cannot navigate. Handle the submit event and call preventDefault().' });
  });
  HTMLFormElement.prototype.submit = function () {
    __send({ type: 'console', level: 'warn', text: 'form.submit() was blocked in the sandbox. Use requestSubmit() with a submit handler instead.' });
  };
  document.addEventListener('DOMContentLoaded', function () { __send({ type: 'booted' }); });
  setInterval(function () { __send({ type: 'alive' }); }, 1000);
}
if (__IS_WORKER && MODE === 'script') {
  var __pending = 0, __ids = {}, __done = false;
  var __st = self.setTimeout, __ct = self.clearTimeout, __si = self.setInterval, __ci = self.clearInterval;
  var __check = function () {
    __st(function () { if (__pending === 0 && !__done) { __done = true; __send({ type: 'done' }); } }, 0);
  };
  self.setTimeout = function (fn, ms) {
    var rest = Array.prototype.slice.call(arguments, 2), id;
    __pending++;
    id = __st(function () { delete __ids[id]; __pending--; try { fn.apply(self, rest); } finally { __check(); } }, ms);
    __ids[id] = 1;
    return id;
  };
  self.clearTimeout = function (id) { if (__ids[id]) { delete __ids[id]; __pending--; __check(); } __ct(id); };
  self.setInterval = function (fn, ms) {
    var rest = Array.prototype.slice.call(arguments, 2), id;
    __pending++;
    id = __si(function () { fn.apply(self, rest); }, ms);
    __ids[id] = 1;
    return id;
  };
  self.clearInterval = function (id) { if (__ids[id]) { delete __ids[id]; __pending--; __check(); } __ci(id); };
  self.__nexusFinish = __check;
}
if (__IS_WORKER && MODE === 'repl') {
  var __indirectEval = eval;
  self.onmessage = function (e) {
    var m = e.data || {};
    var reply = function (ok, v) { __send({ type: 'repl-result', id: m.id, ok: ok, text: __inspect(v, 1, []) }); };
    try {
      var r = __indirectEval(String(m.code));
      if (r && typeof r.then === 'function') { r.then(function (v) { reply(true, v); }, function (err) { reply(false, err); }); }
      else { reply(true, r); }
    } catch (err) { reply(false, err); }
  };
}
`;

/** Source text to place at the very top of a document <script> or a Worker. */
export function bridgeSource(mode: BridgeMode): string {
  return `(function(){var MODE=${JSON.stringify(mode)};${BRIDGE_BODY}})();\n`;
}
