// Headless Edge/Chrome through the DevTools protocol, shared by the page checks (check-html.mjs) and
// the art tools that draw with the browser's canvas (art/font.mjs). Env: CHROME_PATH to override the
// browser, ZM_PRIORITY=normal to run it at normal priority (default: below normal, so the machine stays
// usable while a scenario renders on the CPU), ZM_AFFINITY=<mask> to keep it on some CPUs only.
//
// One browser instance is a dozen processes or more (GPU, renderers, utilities, crashpad), and every
// one of them carries its --user-data-dir on its command line. Killing the browser process alone is
// not enough on a busy machine: on 28.09 renderers and GPU processes busy with the game outlived their
// browser run after run, until 219 of them held 12 GB and the laptop froze. So an instance is closed
// through DevTools first, then every process that names its profile is killed, and a run starts by
// killing whatever earlier runs left (a run stopped from outside never reaches its own clean-up).

import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { constants, freemem, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Every profile folder we make starts with this: it marks our browser processes (their command line). */
const PROFILE_PREFIX = 'zm-check-';
/** Below this much free memory a run waits for it, then gives up instead of piling up browsers. */
const MIN_FREE_MB = 1500;
const IS_WINDOWS = process.platform === 'win32';

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

const powershell = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
  { encoding: 'utf8', timeout: 60000, windowsHide: true }).trim();

/** Ids of the browser processes whose command line contains `needle` (a profile folder, or our prefix). */
function browserPids(needle) {
  if (!IS_WINDOWS) return [];
  const safe = needle.replace(/'/g, "''");
  const out = powershell(`Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" | ` +
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${safe}') } | ForEach-Object { $_.ProcessId }`);
  return out ? out.split(/\s+/).map(Number).filter(Boolean) : [];
}

const killPids = (pids) => pids.length > 0 && powershell(`Stop-Process -Force -ErrorAction SilentlyContinue -Id ${pids.join(',')}`);

/** Kills the browser processes earlier runs left behind (ours only: their profile folder names them). */
export function killStrayBrowsers() {
  const pids = browserPids(PROFILE_PREFIX);
  if (!pids.length) return 0;
  console.warn(`browser: killing ${pids.length} processes left by earlier runs`);
  killPids(pids);
  return pids.length;
}

/**
 * Removes the profile folders earlier runs could not delete (a file was still locked then). They pile up (30 of them, tens
 * of MB each, kept Windows Defender at 95% CPU on 30.09) — call it after killStrayBrowsers, when none can be in use.
 */
export function sweepProfiles() {
  let removed = 0;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
      removed++;
    } catch { /* still locked: the next run tries again */ }
  }
  return removed;
}

/** Waits until the machine has MIN_FREE_MB of free memory (up to a minute), else throws. */
async function waitForMemory() {
  for (let i = 0; freemem() / 2 ** 20 < MIN_FREE_MB; i++) {
    if (i >= 12) throw new Error(`only ${(freemem() / 2 ** 20).toFixed(0)} MB of memory free: not starting another browser`);
    await sleep(5000);
  }
}

/** Closes one instance: through DevTools, then its process, then every process that still names its profile. */
async function closeBrowser(proc, profile, port) {
  if (port) {
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const browser = await connect(webSocketDebuggerUrl);
      await Promise.race([browser.send('Browser.close').catch(() => {}), sleep(2000)]);
    } catch { /* already gone */ }
  }
  for (let i = 0; i < 30 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(100);
  proc.kill();
  await sleep(500);
  let left = browserPids(profile);
  if (left.length) {
    await sleep(2000);
    left = browserPids(profile);
  }
  if (left.length) {
    console.warn(`browser: ${left.length} processes outlived the browser, killing them`);
    killPids(left);
    await sleep(500);
    left = browserPids(profile);
    if (left.length) console.warn(`browser: ${left.length} processes could not be killed: ${left.join(', ')}`);
  }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked, leave it */ }
}

/**
 * Starts a headless browser with a fresh profile, hands `fn` a DevTools connection to its page and
 * closes it afterwards (the whole instance, see above). Default: SwiftShader (software GL, the same on
 * any machine); `gpu`: the real GPU, for FPS numbers.
 */
export async function withBrowser(fn, { gpu = false, autoplay = true } = {}) {
  // The browser inherits this process's priority class (Windows gives a below-normal parent's children
  // the same) and its processor affinity: ZM_AFFINITY (a mask, e.g. 0xFF000 = logical CPUs 12-19, this
  // laptop's efficient cores) keeps a long software-GL run cool and quiet, at a lower frame rate.
  if (process.env.ZM_PRIORITY !== 'normal') {
    try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed: keep normal */ }
  }
  const affinity = Number(process.env.ZM_AFFINITY || 0);
  if (affinity > 0 && IS_WINDOWS) powershell(`(Get-Process -Id ${process.pid}).ProcessorAffinity = ${affinity}`);
  killStrayBrowsers();
  sweepProfiles();
  await waitForMemory();
  const profile = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  const proc = spawn(browserPath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--no-pings',
    ...(gpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    // autoplay: false = the browser's default policy (an AudioContext stays suspended until a user gesture, as on a phone).
    ...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []),
    'about:blank',
  ], { stdio: 'ignore' });
  let port;
  try {
    for (let i = 0; i < 300 && !port; i++) {
      await sleep(100);
      try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ }
    }
    if (!port) throw new Error('browser did not start within 30 s');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    return await fn(await connect(page.webSocketDebuggerUrl));
  } finally {
    await closeBrowser(proc, profile, port);
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
