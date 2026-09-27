#!/usr/bin/env node
// Open a packed playable from file:// in headless Edge/Chrome (DevTools protocol) and check it:
// zero network requests, no console errors, the scene starts, FPS; saves a screenshot per viewport.
//
//   node tools/check-html.mjs dist/ZombieMiner.html [--size 390x844] [--size 844x390] [--wait 15]
//                            [--query zm-inflate=js] [--shots dist/shots]
//
// Env: CHROME_PATH to override the browser. Exit code 1 if any check fails.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const takeAll = (name) => {
  const out = [];
  for (let i = argv.indexOf(name); i >= 0; i = argv.indexOf(name)) out.push(argv.splice(i, 2)[1]);
  return out;
};
const sizes = takeAll('--size');
const waitSec = Number(takeAll('--wait')[0] || 15);
const query = takeAll('--query')[0];
const shotsDir = resolve(takeAll('--shots')[0] || 'dist/shots');
const file = resolve(argv[0] || 'dist/ZombieMiner.html');
if (!sizes.length) sizes.push('390x844', '844x390'); // phone portrait + landscape (CSS px)

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('no Edge/Chrome found; set CHROME_PATH');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withBrowser(fn) {
  const profile = mkdtempSync(join(tmpdir(), 'zm-check-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--no-pings',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
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

async function connect(wsUrl) {
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

const PROBE = `(() => {
  const cc = window.cc, d = cc && cc.director, s = d && d.getScene();
  return { frames: d ? d.getTotalFrames() : 0, scene: s ? s.name : null, timing: window.__ZM_TIMING__,
           loaderGone: !document.getElementById('zm-loading'),
           loaderError: document.getElementById('zm-loading')?.getAttribute('data-error') || null };
})()`;
const FPS = `new Promise((ok) => { const d = cc.director, f0 = d.getTotalFrames(), t0 = performance.now();
  setTimeout(() => ok((d.getTotalFrames() - f0) * 1000 / (performance.now() - t0)), 2000); })`;

let failed = false;
const url = pathToFileURL(file).href + (query ? `?${query}` : '');
console.log(`${basename(file)}  (${(readFileSync(file).length / 1e6).toFixed(3)} MB) in ${basename(exe)}`);
mkdirSync(shotsDir, { recursive: true });

await withBrowser(async (cdp) => {
  const requests = [];
  const problems = [];
  cdp.on((method, p) => {
    if (method === 'Network.requestWillBeSent') requests.push(p.request.url);
    if (method === 'Runtime.exceptionThrown') problems.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) {
      problems.push(`console.${p.type}: ` + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (method === 'Log.entryAdded' && p.entry.level === 'error') problems.push(`log: ${p.entry.text} ${p.entry.url || ''}`);
  });
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  for (const size of sizes) {
    const [width, height] = size.split('x').map(Number);
    requests.length = 0;
    problems.length = 0;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url });
    let probe;
    const t0 = Date.now();
    do {
      await sleep(250);
      probe = await cdp.evaluate(PROBE).catch(() => null);
    } while ((!probe || !probe.scene || probe.frames < 10) && !probe?.loaderError && Date.now() - t0 < waitSec * 1000);
    const fps = probe?.scene ? await cdp.evaluate(FPS) : 0;
    const shot = join(shotsDir, `${basename(file, '.html')}-${size}${query ? '-' + query.replace(/\W+/g, '_') : ''}.png`);
    writeFileSync(shot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    const external = requests.filter((u) => u !== url && !/^(blob|data):/.test(u));
    const t = probe?.timing || {};
    const ms = (a, b) => (t[a] != null && t[b] != null ? `${(t[b] - t[a]).toFixed(0)} ms` : '-');
    const ok = probe?.scene && probe.loaderGone && external.length === 0 && problems.length === 0;
    failed ||= !ok;
    console.log(`\n[${size}] ${ok ? 'PASS' : 'FAIL'}  scene=${probe?.scene} loaderGone=${probe?.loaderGone} frames=${probe?.frames} fps≈${fps.toFixed(0)}` +
      (t.jsInflate ? ' (JS inflate)' : ''));
    console.log(`  timing: decode ${ms('start', 'base64')}, inflate ${ms('base64', 'inflate')}, engine+scene ${ms('boot', 'firstFrames')}, total ${ms('start', 'firstFrames')}`);
    console.log(`  requests: ${requests.length} total, ${external.length} outside the file` + external.map((u) => `\n    ${u}`).join(''));
    if (probe?.loaderError) console.log(`  loader error: ${probe.loaderError}`);
    for (const p of problems) console.log(`  ${p}`);
    console.log(`  screenshot: ${shot}`);
  }
});
process.exit(failed ? 1 : 0);
