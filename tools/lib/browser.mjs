// Headless Edge/Chrome through the DevTools protocol, shared by the page checks (check-html.mjs) and
// the art tools that draw with the browser's canvas (art/font.mjs). Env: CHROME_PATH to override the
// browser.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

/** The browser executable to use; throws when none is installed. */
export function browserPath() {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('no Edge/Chrome found; set CHROME_PATH');
  return exe;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts a headless browser with a fresh profile, hands `fn` a DevTools connection to its page and
 * closes it afterwards. Default: SwiftShader (software GL, the same on any machine); `gpu`: the real
 * GPU, for FPS numbers.
 */
export async function withBrowser(fn, { gpu = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'zm-check-'));
  const proc = spawn(browserPath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--no-pings',
    ...(gpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100);
      try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ }
    }
    if (!port) throw new Error('browser did not start');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    return await fn(await connect(page.webSocketDebuggerUrl));
  } finally {
    proc.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked, leave it */ }
  }
}

/** A DevTools connection: send(method, params), evaluate(expression) by value, on/off(listener). */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, err } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? err(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg.method, msg.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((ok, err) => {
      pending.set(++id, { ok, err });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const off = (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  return { send, evaluate, on: (fn) => listeners.push(fn), off, close: () => ws.close() };
}
