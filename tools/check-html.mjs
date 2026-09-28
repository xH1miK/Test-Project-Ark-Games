#!/usr/bin/env node
// Open the game in headless Edge/Chrome (DevTools protocol) and check it: zero requests outside the
// target, no console errors, the scene starts, FPS; saves a screenshot per viewport. Optionally runs a
// scenario (tools/scenarios/<name>.mjs) that drives the game through the ?qa hooks (window.__zm).
//
//   node tools/check-html.mjs [dist/ZombieMiner.html | http://localhost:7456/] [--size 390x844] [--size 844x390]
//                            [--wait 15] [--query zm-inflate=js] [--shots dist/shots] [--scenario level] [--gpu] [--webgl1]
//
// A file is opened from file:// (the real ad-network condition); an http URL (e.g. the editor preview)
// is handy while iterating. The page runs as a phone: mobile viewport, DPR 2, touch screen.
// --webgl1 hides WebGL 2 from the page (as on an old phone), so the engine falls back to WebGL 1;
// --hide-ext EXT_frag_depth (repeatable) hides a WebGL extension, as on a GPU without it.
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
const useGpu = argv.includes('--gpu') && Boolean(argv.splice(argv.indexOf('--gpu'), 1));
const webgl1 = argv.includes('--webgl1') && Boolean(argv.splice(argv.indexOf('--webgl1'), 1));
const hiddenExtensions = takeAll('--hide-ext');
const waitSec = Number(takeAll('--wait')[0] || 15);
const scenarioName = takeAll('--scenario')[0];
const queryParts = [takeAll('--query')[0], scenarioName && 'qa=1'].filter(Boolean);
const shotsDir = resolve(takeAll('--shots')[0] || 'dist/shots');
const target = argv[0] || 'dist/ZombieMiner.html';
if (!sizes.length) sizes.push('390x844', '844x390'); // phone portrait + landscape (CSS px)

const isHttp = /^https?:\/\//.test(target);
const baseUrl = isHttp ? target : pathToFileURL(resolve(target)).href;
const url = baseUrl + (queryParts.length ? `${baseUrl.includes('?') ? '&' : '?'}${queryParts.join('&')}` : '');
const label = isHttp ? new URL(target).host.replace(/\W+/g, '_') : basename(target, '.html');
/** Requests that stay inside the playable: the file itself, blob:/data: URLs, or the same http origin. */
const isInternal = (u) => /^(blob|data):/.test(u) || (isHttp ? u.startsWith(new URL(target).origin) : u.split('?')[0] === baseUrl);

const scenario = scenarioName ? (await import(pathToFileURL(resolve(`tools/scenarios/${scenarioName}.mjs`)).href)).default : null;

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
    // Default: SwiftShader (software GL, same result on any machine). --gpu: the real GPU, for FPS numbers.
    ...(useGpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

const PROBE = `(() => {
  const cc = window.cc, d = cc && cc.director, s = d && d.getScene();
  // The editor preview loads the scene without its asset name.
  return { frames: d ? d.getTotalFrames() : 0, scene: s && s.children.length ? s.name || '(preview)' : null, timing: window.__ZM_TIMING__,
           loaderGone: !document.getElementById('zm-loading'),
           loaderError: document.getElementById('zm-loading')?.getAttribute('data-error') || null };
})()`;
const FPS = `new Promise((ok) => { const d = cc.director, f0 = d.getTotalFrames(), t0 = performance.now();
  setTimeout(() => ok((d.getTotalFrames() - f0) * 1000 / (performance.now() - t0)), 2000); })`;

/** Helpers handed to a scenario: page access, waiting, screenshots, soft assertions. */
function scenarioContext(cdp, size, results) {
  const shot = async (name) => {
    const file = join(shotsDir, `${label}-${size}-${name}.png`);
    writeFileSync(file, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    results.shots.push(file);
    return file;
  };
  return {
    size,
    shotsDir,
    evaluate: cdp.evaluate,
    sleep,
    shot,
    /** Real touch input through DevTools: type touchStart | touchMove | touchEnd, point in CSS px. */
    touch: (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    }),
    log: (...args) => results.log.push(args.join(' ')),
    check: (ok, message) => {
      results.checks.push({ ok: !!ok, message });
      return !!ok;
    },
    /** Waits until `expression` is truthy in the page; returns its value or throws on timeout. */
    waitFor: async (expression, timeoutMs = 10000) => {
      const t0 = Date.now();
      for (;;) {
        const v = await cdp.evaluate(expression).catch(() => null);
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for: ${expression}`);
        await sleep(100);
      }
    },
    /** Waits for n more engine frames. */
    frames: (n) => cdp.evaluate(`new Promise((ok) => { const d = cc.director, f = d.getTotalFrames() + ${n};
      const tick = () => d.getTotalFrames() >= f ? ok(true) : requestAnimationFrame(tick); tick(); })`),
    /** The page's live JS heap after a full garbage collection, bytes: { usedSize, totalSize }. */
    heap: async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return cdp.send('Runtime.getHeapUsage');
    },
  };
}

let failed = false;
console.log(`${label}${isHttp ? '' : `  (${(readFileSync(target).length / 1e6).toFixed(3)} MB)`} in ${basename(exe)}` +
  ` (${useGpu ? 'GPU' : 'SwiftShader'}${webgl1 ? ', WebGL 1 forced' : ''}${hiddenExtensions.map((e) => `, no ${e}`).join('')})` +
  (scenarioName ? `, scenario: ${scenarioName}` : ''));
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
  if (webgl1) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : getContext.call(this, type, ...rest); };
    })()` });
  }
  if (hiddenExtensions.length) {
    // An extension never enabled through getExtension is not available to shaders either.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const hidden = ${JSON.stringify(hiddenExtensions)};
      for (const proto of [WebGLRenderingContext.prototype, window.WebGL2RenderingContext && WebGL2RenderingContext.prototype].filter(Boolean)) {
        const get = proto.getExtension, list = proto.getSupportedExtensions;
        proto.getExtension = function (name) { return hidden.includes(name) ? null : get.call(this, name); };
        proto.getSupportedExtensions = function () { return (list.call(this) || []).filter((n) => !hidden.includes(n)); };
      }
    })()` });
  }

  for (const size of sizes) {
    const [width, height] = size.split('x').map(Number);
    requests.length = 0;
    problems.length = 0;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    // A phone has a touch screen: the engine picks touch input at startup ('ontouchstart' in window).
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.navigate', { url });
    let probe;
    const t0 = Date.now();
    do {
      await sleep(250);
      probe = await cdp.evaluate(PROBE).catch(() => null);
    } while ((!probe || !probe.scene || probe.frames < 10) && !probe?.loaderError && Date.now() - t0 < waitSec * 1000);
    const fps = probe?.scene ? await cdp.evaluate(FPS) : 0;
    const shot = join(shotsDir, `${label}-${size}${queryParts.length ? '-' + queryParts.join('_').replace(/\W+/g, '_') : ''}.png`);
    writeFileSync(shot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    const results = { checks: [], log: [], shots: [] };
    if (scenario && probe?.scene) {
      try {
        await scenario(scenarioContext(cdp, size, results));
      } catch (err) {
        results.checks.push({ ok: false, message: `scenario threw: ${err.message}` });
      }
    }

    const external = requests.filter((u) => !isInternal(u));
    const t = probe?.timing || {};
    const ms = (a, b) => (t[a] != null && t[b] != null ? `${(t[b] - t[a]).toFixed(0)} ms` : '-');
    const scenarioOk = results.checks.every((c) => c.ok);
    const ok = probe?.scene && probe.loaderGone && external.length === 0 && problems.length === 0 && scenarioOk;
    failed ||= !ok;
    console.log(`\n[${size}] ${ok ? 'PASS' : 'FAIL'}  scene=${probe?.scene} loaderGone=${probe?.loaderGone} frames=${probe?.frames} fps≈${fps.toFixed(0)}` +
      (t.jsInflate ? ' (JS inflate)' : ''));
    if (!isHttp) console.log(`  timing: decode ${ms('start', 'base64')}, inflate ${ms('base64', 'inflate')}, engine+scene ${ms('boot', 'firstFrames')}, total ${ms('start', 'firstFrames')}`);
    console.log(`  requests: ${requests.length} total, ${external.length} outside the target` + external.map((u) => `\n    ${u}`).join(''));
    if (probe?.loaderError) console.log(`  loader error: ${probe.loaderError}`);
    for (const p of problems) console.log(`  ${p}`);
    for (const line of results.log) console.log(`  | ${line.split('\n').join('\n  | ')}`);
    for (const c of results.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.message}`);
    console.log(`  screenshots: ${[shot, ...results.shots].join('\n               ')}`);
  }
});
process.exit(failed ? 1 : 0);
