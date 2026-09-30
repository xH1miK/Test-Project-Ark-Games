// Screen sizes and shapes (S4): the game is resized on the fly through a list of phones, tablets and extremes
// (t.resize = a new DevTools device size, as a rotation or a window drag would give) and at every size, with the page as
// it really is (portrait and landscape, narrow and wide, DPR 1 and 2):
//   * the canvas fills the page and the UI's design resolution fits the screen (the whole design frame in view);
//   * the HUD sits where it should: the coin counter in the top-right corner, the mute button in the bottom-left with a
//     finger-sized touch area, the joystick's ring at rest inside the screen and centred, its touch area the whole page;
//   * the finale's title is fully on the screen (its pulse included) and big enough to read;
//   * the world at the start: with the start beat toward the shredder at its peak both the tractor and the shredder are on
//     the screen (world points projected through the main camera, as shares of the screen);
//   * real touches (DevTools input events): the stick steers from a touch at the middle of the screen and the mute button
//     toggles at its new place (the hit areas follow the layout).
// The chain starts from the size the page was opened at (fresh load: the first step measures it before any resize), so
// run it also with other --size values: 360x640, 412x915, 1024x768 ...
//
//   node tools/check-html.mjs <html|url> --scenario sizes --size 390x844 [--gpu]

import { gameWait, installAutopilot } from './lib/autopilot.mjs';

/** [width, height, device pixel ratio] in CSS px; portrait and landscape alternate so every step is a live rotation. */
const CHAIN = [
  [844, 390, 2], [360, 640, 2], [915, 412, 2], [320, 568, 2], [1024, 768, 2], [412, 915, 2], [640, 360, 2], [768, 1024, 2],
  [300, 800, 2], [1200, 540, 2], [375, 667, 2], [2400, 1080, 1], [1400, 480, 2], [390, 844, 2],
];

const PAGE = (path) => `(() => {
  const ui = cc.find('Canvas/Camera').getComponent(cc.js.getClassByName('cc.Camera')), UIT = cc.js.getClassByName('cc.UITransform');
  const canvas = cc.game.canvas, rect = canvas.getBoundingClientRect();
  const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
  const box = cc.find('${path}').getComponent(UIT).getBoundingBoxToWorld(), lo = new cc.Vec3(), hi = new cc.Vec3();
  ui.worldToScreen(new cc.Vec3(box.x, box.y, 0), lo); ui.worldToScreen(new cc.Vec3(box.x + box.width, box.y + box.height, 0), hi);
  const r = { left: rect.left + lo.x * sx, right: rect.left + hi.x * sx, top: rect.top + (canvas.height - hi.y) * sy, bottom: rect.top + (canvas.height - lo.y) * sy };
  r.cx = (r.left + r.right) / 2; r.cy = (r.top + r.bottom) / 2; r.w = r.right - r.left; r.h = r.bottom - r.top;
  return r;
})()`;

const LAYOUT = `(() => {
  const canvas = cc.game.canvas, rect = canvas.getBoundingClientRect(), win = cc.screen.windowSize, dr = cc.view.getDesignResolutionSize();
  return { page: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, canvas: { left: rect.left, top: rect.top, w: rect.width, h: rect.height, px: [canvas.width, canvas.height] },
    window: { w: win.width, h: win.height }, design: { w: dr.width, h: dr.height }, titleOn: cc.find('Canvas/Hud/Finale/Title').active };
})()`;

/** World point -> share of the screen (y down), through the main camera. */
const SCREEN_OF = (x, y, z) => `(() => { const cam = cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')), out = new cc.Vec3();
  cam.worldToScreen(new cc.Vec3(${x}, ${y}, ${z}), out); const w = cam.camera.width, h = cam.camera.height;
  return { x: out.x / w, y: 1 - out.y / h }; })()`;

const inside = (r, page, margin = 0) => r.left >= -0.5 + margin && r.top >= -0.5 + margin && r.right <= page.w + 0.5 - margin && r.bottom <= page.h + 0.5 - margin;
const within = (p, margin) => p.x >= margin && p.x <= 1 - margin && p.y >= margin && p.y <= 1 - margin;
const fmt = (p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;

export default async function sizes(t) {
  await t.waitFor('!!(window.__zm && window.__zm.camera && window.__zm.muteButton && window.__zm.finaleView)');
  await installAutopilot(t);
  await t.evaluate('__zm.sound.setMuted(false), true');
  const cfg = await t.evaluate('__zm.config');
  const [w0, h0] = t.size.split('x').map(Number);
  const steps = [[w0, h0, 2], ...CHAIN.filter(([w, h]) => !(w === w0 && h === h0))];
  const rows = [];
  let first = true;
  const home = await t.evaluate('({ x: __zm.tractor.x, z: __zm.tractor.z, yaw: __zm.tractor.yaw })');
  const goHome = () => t.evaluate(`(() => { const tr = __zm.tractor; tr.place(${home.x}, ${home.z}, ${home.yaw}); __zm.camera.snap(tr.x, 0, tr.z); })()`);
  for (const [w, h, dpr] of steps) {
    const label = `${w}x${h}@${dpr}`;
    const problems = [];
    const check = (ok, message) => { if (!ok) problems.push(message); return ok; };
    if (!first) {
      await t.resize(w, h, dpr);
      await t.frames(4);
      await t.sleep(300);
    }
    first = false;
    await goHome();
    await t.frames(2);

    // The canvas and the design resolution.
    const L = await t.evaluate(LAYOUT);
    const page = { w: L.page.w, h: L.page.h };
    check(Math.abs(L.canvas.w - page.w) < 1.5 && Math.abs(L.canvas.h - page.h) < 1.5 && Math.abs(L.canvas.left) < 1.5 && Math.abs(L.canvas.top) < 1.5, `the canvas fills the page (${L.canvas.w.toFixed(0)}x${L.canvas.h.toFixed(0)} at ${L.canvas.left.toFixed(0)},${L.canvas.top.toFixed(0)} in ${page.w}x${page.h})`);
    const frameH = page.w > page.h ? cfg.ui.landscapeHeight : cfg.ui.designHeight;
    const scale = Math.min(L.window.w / cfg.ui.designWidth, L.window.h / frameH);
    check(Math.abs(L.design.w - L.window.w / scale) < 0.5 && Math.abs(L.design.h - L.window.h / scale) < 0.5,
      `the design resolution fits the frame (${L.design.w.toFixed(0)}x${L.design.h.toFixed(0)}, wanted ${(L.window.w / scale).toFixed(0)}x${(L.window.h / scale).toFixed(0)})`);
    check(L.design.w >= cfg.ui.designWidth - 0.5 && L.design.h >= frameH - 0.5, 'the whole design frame is in view');

    // The UI in place.
    const plate = await t.evaluate(PAGE('Canvas/Hud/CoinHud/Plate'));
    const mute = await t.evaluate(PAGE('Canvas/Hud/MuteButton'));
    const icon = await t.evaluate(PAGE('Canvas/Hud/MuteButton/Icon'));
    const ring = await t.evaluate(PAGE('Canvas/Joystick/Base'));
    const area = await t.evaluate(PAGE('Canvas/Joystick'));
    check(inside(plate, page), 'the coin counter is fully on screen');
    check(page.w - plate.right < 0.1 * page.w && plate.top < 0.1 * page.h, `the coin counter is in the top-right corner (${(page.w - plate.right).toFixed(0)} px from the right, ${plate.top.toFixed(0)} from the top)`);
    check(inside(mute, page), 'the mute button is fully on screen');
    check(mute.left < 0.1 * page.w && page.h - mute.bottom < 0.1 * page.h, 'the mute button is in the bottom-left corner');
    check(mute.w >= 44 && mute.h >= 44, `the mute button's touch area is a finger's size (${mute.w.toFixed(0)} px)`);
    check(icon.w >= 22, `the mute icon is not tiny (${icon.w.toFixed(0)} px)`);
    check(inside(ring, page), 'the joystick ring at rest is fully on screen');
    check(Math.abs(ring.cx - page.w / 2) < 0.02 * page.w, 'the joystick rests at the horizontal middle');
    check(area.left <= 0.5 && area.top <= 0.5 && area.right >= page.w - 0.5 && area.bottom >= page.h - 0.5, 'the joystick touch area covers the whole page');
    let title = null;
    if (L.titleOn) {
      title = await t.evaluate(PAGE('Canvas/Hud/Finale/Title'));
      const grow = 1.06; // the pulse scales the title by up to 5%
      const half = (title.w * grow) / 2;
      check(title.cx - half >= 0 && title.cx + half <= page.w, `the finale title fits the screen width with its pulse (${title.w.toFixed(0)} of ${page.w} px)`);
      check(title.w >= 0.35 * Math.min(page.w, page.h * 1.0) , `the finale title is big enough to read (${title.w.toFixed(0)} px)`);
      check(title.top >= 0 && title.bottom <= page.h, 'the finale title is vertically on screen');
    }

    // The world at the start: the beat toward the shredder at its peak.
    await t.evaluate(`(() => { const sh = cc.find('Level/Shredder').worldPosition; __zm.camera.peek(sh.x, sh.z, __zm.config.camera.peekStart); })()`);
    await t.waitFor('__zm.camera.peekWeight > 0.99', 20000);
    await gameWait(t, 0.8);
    const s = await t.evaluate(`(() => { const sh = cc.find('Level/Shredder').worldPosition, tr = __zm.tractor;
      return { aspect: innerWidth / innerHeight, framing: __zm.camera.framing, shredder: [sh.x, sh.y, sh.z], tractor: [tr.x, 0.5, tr.z] }; })()`);
    const shredder = await t.evaluate(SCREEN_OF(...s.shredder));
    const tractor = await t.evaluate(SCREEN_OF(...s.tractor));
    check(within(tractor, 0.05), `the tractor is on the screen at the start beat (${fmt(tractor)})`);
    check(within(shredder, 0.02), `the shredder is on the screen at the start beat (${fmt(shredder)})`);

    // Real touches: steer from the middle of the screen, tap the mute button where it is now.
    const cx = page.w / 2, cy = page.h * 0.55;
    await t.touch('touchStart', cx, cy);
    await t.sleep(100);
    const drag = ring.w * 0.35; // 0.7 of the ring's radius
    await t.touch('touchMove', cx + drag, cy);
    await t.sleep(250);
    const stick = await t.evaluate('({ held: __zm.joystick.isHeld, x: __zm.joystick.stick.x, z: __zm.joystick.stick.y })');
    await t.touch('touchEnd', cx + drag, cy);
    await t.sleep(250);
    check(stick.held && Math.hypot(stick.x, stick.z) > 0.5, `a touch at the middle steers (stick ${stick.x.toFixed(2)}, ${stick.z.toFixed(2)})`);
    const before = await t.evaluate('__zm.sound.muted');
    await t.touch('touchStart', mute.cx, mute.cy);
    await t.sleep(80);
    await t.touch('touchEnd', mute.cx, mute.cy);
    await t.sleep(250);
    check((await t.evaluate('__zm.sound.muted')) !== before, 'a tap at the mute button\'s place toggles the sound');
    await t.touch('touchStart', mute.cx, mute.cy);
    await t.sleep(80);
    await t.touch('touchEnd', mute.cx, mute.cy);
    await t.sleep(250);
    check((await t.evaluate('__zm.sound.muted')) === before, 'and the second tap toggles it back');

    await t.shot(`size-${w}x${h}`);
    if (!L.titleOn) await t.evaluate('__zm.finaleView.play(), true'); // from the next size on the title is measured too
    rows.push({ label, aspect: s.aspect, framing: s.framing, tractor, shredder, plate: plate.w, mute: mute.w, ring: ring.w, title: title && title.w, problems });
    t.check(problems.length === 0, `${label} (aspect ${s.aspect.toFixed(2)}, framing ${s.framing.toFixed(2)}): ${problems.length ? problems.join('; ') : 'layout, world and touches are all right'}`);
  }
  t.log('sizes: ' + rows.map((r) => `${r.label} counter ${r.plate.toFixed(0)}px mute ${r.mute.toFixed(0)}px ring ${r.ring.toFixed(0)}px${r.title ? ' title ' + r.title.toFixed(0) + 'px' : ''} tractor ${fmt(r.tractor)} shredder ${fmt(r.shredder)}`).join('\n  | '));
}
