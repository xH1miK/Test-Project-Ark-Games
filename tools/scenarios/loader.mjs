// Loader check (Build stage): the packed page's own script (tools/pack/runtime.js) and the ad container around it.
// MRAID: what the page does when the container hides and shows the ad (a swipe away, another app in front, the ad
// closed). Many WebViews fire no `visibilitychange` for that, so the loader listens to MRAID `viewableChange` and turns it
// into the page-visibility signal the engine and its AudioSources already obey (`document.hidden` / `visibilityState`
// + a `visibilitychange` event). Also `?stats`: the FPS / draw-call readout for a phone without DevTools.
//   node tools/check-html.mjs dist/ZombieMiner.html --scenario loader
// The container is a mock (initScript, before anything else): `window.mraid` in state `loading` that sends `ready` 700 ms
// after the page started, `isViewable()`, `addEventListener('viewableChange')`; `window.__mraid.setViewable(v)` plays the
// container. `?mraid=hidden` makes it start with the ad not viewable, `?mraid=none` installs no MRAID at all.
// Checks: the boot waits for `ready`; the loader listened to `viewableChange`; not viewable = the page reads hidden,
// the game stops counting (frames and game time) and the sound falls silent, viewable again = all of it comes back;
// the real page visibility and MRAID combine (the game runs only when both say visible; repeated events do not stack);
// an ad that is loaded while not viewable stands still until it is shown; with no MRAID at all the loader leaves
// `document.hidden` alone; `?stats` puts a readout in the top-left corner (inside the safe area, clicks pass through it)
// and without the flag the page has none.

import { TAP_SCRIPT } from './lib/audio-tap.mjs';

const MOCK = `(() => {
  const mode = new URLSearchParams(location.search).get('mraid');
  if (mode === 'none') return;
  const listeners = {};
  const mock = (window.__mraid = { state: 'loading', viewable: mode !== 'hidden', readyAt: null, listened: [], opened: [] });
  const fire = (ev, ...args) => (listeners[ev] || []).slice().forEach((fn) => fn(...args));
  window.mraid = {
    getState: () => mock.state,
    getVersion: () => '3.0',
    isViewable: () => mock.viewable,
    addEventListener: (ev, fn) => { mock.listened.push(ev); (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    open: (url) => mock.opened.push(url),
  };
  mock.setViewable = (v) => { mock.viewable = v; fire('viewableChange', v); };
  setTimeout(() => { mock.state = 'default'; mock.readyAt = performance.now(); fire('ready'); }, 700);
})();`;

export const initScript = MOCK + TAP_SCRIPT;

export default async function (t) {
  const frames = () => t.evaluate('cc.director.getTotalFrames()');
  const now = () => t.evaluate('__zm.sound.now');
  const peek = () => t.evaluate('window.__audio.peek()');
  const reset = () => t.evaluate('window.__audio.reset(), true');
  const hidden = () => t.evaluate('document.hidden');
  const setViewable = (v) => t.evaluate(`__mraid.setViewable(${v}), true`);
  // The real page visibility, as a browser tab switch would change it (the prototype's getters, which the loader reads).
  const setReal = (isHidden) => t.evaluate(`(() => {
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => ${isHidden} });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => ${isHidden ? "'hidden'" : "'visible'"} });
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);

  /** The game stands still: no engine frames, no game time, no sound. */
  const stands = async (message) => {
    await t.sleep(250);
    const f = await frames(), n = await now();
    await reset();
    await t.sleep(400);
    const p = await peek();
    t.check((await frames()) === f && (await now()) === n && p.peak < 0.002, `${message}: stands still and silent (frames ${f} -> ${await frames()}, peak ${p.peak.toFixed(4)})`);
  };
  /** The game runs: frames and time advance and the music is audible. */
  const runs = async (message) => {
    const f = await frames(), n = await now();
    await reset();
    await t.sleep(700);
    const p = await peek();
    t.check((await frames()) > f + 10 && (await now()) > n + 0.3 && p.peak > 0.005, `${message}: running and audible (frames +${(await frames()) - f}, peak ${p.peak.toFixed(3)})`);
  };

  // 1. The container: the boot waited for `ready`, the loader listens to `viewableChange`.
  const boot = await t.evaluate('({ boot: __ZM_TIMING__.boot, readyAt: __mraid.readyAt, listened: __mraid.listened })');
  t.check(boot.readyAt != null && boot.boot >= boot.readyAt, `the boot waited for MRAID ready (ready at ${boot.readyAt?.toFixed(0)} ms, boot at ${boot.boot?.toFixed(0)} ms)`);
  t.check(boot.listened.includes('viewableChange'), `the loader listens to viewableChange (${boot.listened})`);
  await t.waitFor('__zm.sound.unlocked', 5000);
  await t.sleep(500);
  t.check(!(await hidden()), 'viewable at the start: the page reads visible');
  await runs('viewable');

  // 2. The container hides the ad and shows it again.
  await setViewable(false);
  t.check((await hidden()) && (await t.evaluate('document.visibilityState')) === 'hidden', 'not viewable: the page reads hidden');
  await stands('not viewable');
  await setViewable(true);
  t.check(!(await hidden()) && (await t.evaluate('document.visibilityState')) === 'visible', 'viewable again: the page reads visible');
  await runs('viewable again');

  // 3. Repeated events do not stack: hide, hide, show = shown.
  await setViewable(false);
  await setViewable(false);
  await stands('hidden twice');
  await setViewable(true);
  await runs('shown once after two hides');

  // 4. The real page visibility and MRAID combine: the game runs only when both say visible.
  await setReal(true);
  t.check(await hidden(), 'the tab is hidden: the page reads hidden');
  await stands('tab hidden');
  await setViewable(false);
  await setViewable(true);
  t.check(await hidden(), 'MRAID says viewable but the tab is hidden: still hidden');
  await stands('MRAID viewable, tab hidden');
  await setViewable(false);
  await setReal(false);
  t.check(await hidden(), 'the tab is back but MRAID says not viewable: still hidden');
  await stands('tab visible, MRAID not viewable');
  await setViewable(true);
  t.check(!(await hidden()), 'both say visible: the page reads visible');
  await runs('both visible');

  // 5. An ad loaded while it is not viewable stands still until it is shown.
  await t.evaluate("location.href = location.pathname + '?qa&nopeek&mraid=hidden', true").catch(() => null);
  await t.waitFor('window.__mraid && __mraid.readyAt != null && !!window.cc && cc.director.getTotalFrames() >= 3', 20000);
  await t.sleep(1500);
  t.check(await hidden(), 'loaded not viewable: the page reads hidden');
  await stands('loaded not viewable');
  await setViewable(true);
  await runs('shown after a hidden load');

  // 6. No MRAID at all: the loader leaves the page's visibility alone.
  await t.evaluate("location.href = location.pathname + '?qa&nopeek&mraid=none', true").catch(() => null);
  await t.waitFor('!!window.cc && cc.director.getTotalFrames() >= 10 && !!window.__zm', 20000);
  const plain = await t.evaluate("({ mraid: typeof window.mraid, own: !!Object.getOwnPropertyDescriptor(document, 'hidden') })");
  t.check(plain.mraid === 'undefined' && !plain.own, `without MRAID the loader does not touch document.hidden (mraid ${plain.mraid}, own property ${plain.own})`);
  await t.waitFor('__zm.sound.unlocked', 5000);
  await runs('without MRAID');

  // 7. The page is only a canvas to steer on: nothing scrolls, pulls to refresh, bounces, zooms or opens a menu on a long press.
  const page = await t.evaluate(`(() => {
    const s = (e) => { const c = getComputedStyle(e); return { overflow: c.overflow, overscroll: c.overscrollBehaviorY, touch: c.touchAction, callout: c.getPropertyValue('-webkit-touch-callout') }; };
    return { html: s(document.documentElement), body: s(document.body), scrolls: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
             viewport: document.querySelector('meta[name=viewport]').content };
  })()`);
  t.log('page: ' + JSON.stringify(page));
  t.check(['html', 'body'].every((k) => page[k].overflow === 'hidden' && page[k].overscroll === 'none' && page[k].touch === 'none'), 'html and body: no overflow, no overscroll, touch-action none');
  t.check(!page.scrolls, 'the page has nothing to scroll to');
  t.check(/viewport-fit=cover/.test(page.viewport), 'the viewport asks for the whole screen (viewport-fit=cover): the game runs under a cut-out, the Hud stays in the safe area');

  // 8. `?stats`: absent by default, a readout with the flag.
  const readout = () => t.evaluate(`(() => {
    const el = [...document.body.children].find((e) => e.style && e.style.fontFamily.includes('monospace'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom, events: getComputedStyle(el).pointerEvents,
             w: innerWidth, h: innerHeight };
  })()`);
  t.check((await readout()) === null, 'no ?stats: the page has no readout');
  await t.evaluate("location.href = location.pathname + '?qa&nopeek&mraid=none&stats', true").catch(() => null);
  await t.waitFor('!!window.cc && cc.director.getTotalFrames() >= 10 && !!window.__zm', 20000);
  await t.sleep(2200);
  const stats = await readout();
  t.log('readout: ' + JSON.stringify(stats));
  t.check(stats && /^fps \d+ +worst \d+ ms +dc \d+$/.test(stats.text), `?stats: the readout shows fps, the worst frame and draw calls ("${stats?.text}")`);
  const fps = Number(/fps (\d+)/.exec(stats?.text ?? '')?.[1]), dc = Number(/dc (-?\d+)/.exec(stats?.text ?? '')?.[1]);
  t.check(fps >= 1 && fps <= 125 && dc >= 5 && dc <= 30, `?stats: the numbers are the game's (fps ${fps}, draw calls ${dc})`);
  t.check(stats && stats.left >= 0 && stats.top >= 0 && stats.right < stats.w / 2 && stats.bottom < stats.h / 4, '?stats: the readout sits in the top-left corner, on the screen');
  t.check(stats && stats.events === 'none', '?stats: touches pass through the readout');
}
