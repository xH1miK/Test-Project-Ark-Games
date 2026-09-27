// M2 drive check. An autopilot drives the tractor round the arena by overriding the move input on
// every engine frame (EVENT_BEFORE_UPDATE), rams a wall, the shredder and a corner; the tractor's
// penetration into static obstacles is measured after every frame (EVENT_AFTER_UPDATE) and must stay
// under 0.05. Then the camera follow and the tier zoom are checked, and real touch events (DevTools
// Input.dispatchTouchEvent) drive the joystick itself: base under the finger, camera-relative
// direction, release and glide back, a touch on the resting base.
//
//   node tools/check-html.mjs <html|url> --scenario drive [--gpu]

const MAX_PENETRATION = 0.05;

/** In-page autopilot and per-frame probes, installed once per page load. */
const INSTALL = `(() => {
  if (window.__ap) return 'already';
  const zm = window.__zm, tmp = { x: 0, z: 0 };
  const ap = window.__ap = { legs: [], i: 0, t: 0, clock: 0, running: false, results: [], worst: 0, worstAt: null,
    legWorst: 0, nan: false, box: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity } };
  const begin = () => {
    const leg = ap.legs[ap.i];
    if (leg) { leg.fromX = zm.tractor.x; leg.fromZ = zm.tractor.z; leg.odo0 = zm.tractor.odometer; }
  };
  const finish = (ok, reason) => {
    const leg = ap.legs[ap.i], tr = zm.tractor;
    ap.results.push({ name: leg.name, ok, reason, x: +tr.x.toFixed(2), z: +tr.z.toFixed(2), t: +ap.t.toFixed(2),
      moved: +(tr.odometer - leg.odo0).toFixed(2), worst: +ap.legWorst.toFixed(4) });
    ap.i++; ap.t = 0; ap.legWorst = 0;
    if (ap.i >= ap.legs.length) { ap.running = false; zm.input.release(); } else begin();
  };
  ap.run = (legs) => { ap.legs = legs; ap.i = 0; ap.t = 0; ap.results = []; ap.legWorst = 0; ap.running = true; begin(); };
  cc.director.on(cc.Director.EVENT_BEFORE_UPDATE, () => {
    if (!ap.running) return;
    const leg = ap.legs[ap.i], tr = zm.tractor, radius = leg.radius || 1;
    if (leg.kind === 'goto') {
      const dx = leg.x - tr.x, dz = leg.z - tr.z, dist = Math.hypot(dx, dz);
      // At low FPS the tractor may step over the waypoint: done once it is behind.
      const passed = dx * (leg.x - leg.fromX) + dz * (leg.z - leg.fromZ) <= 0;
      if (dist <= radius) return finish(true, 'reached');
      if (passed) return finish(true, 'passed');
      zm.input.override(dx / dist, dz / dist);
    } else if (leg.kind === 'push') {
      if (ap.t >= leg.time) return finish(true, 'time');
      zm.input.override(leg.dx, leg.dz);
    } else if (leg.kind === 'stop') {
      zm.input.override(0, 0);
      if (ap.t >= leg.time && tr.speed === 0) return finish(true, 'stopped');
    }
    if (ap.t > (leg.timeout || 20)) finish(false, 'timeout');
  });
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, () => {
    const dt = Math.min(cc.game.deltaTime, 0.25); // the clamp GameRoot applies (Config.time.maxFrameDt)
    ap.clock += dt;
    if (ap.running) ap.t += dt;
    const tr = zm.tractor;
    if (!Number.isFinite(tr.x) || !Number.isFinite(tr.z) || !Number.isFinite(tr.yaw)) ap.nan = true;
    const pen = zm.obstacles.resolveCircle(tr.bodyX, tr.bodyZ, tr.bodyRadius, 1, tmp); // 1 = Blocks.Tractor
    if (pen > ap.worst) { ap.worst = pen; ap.worstAt = { x: +tr.x.toFixed(3), z: +tr.z.toFixed(3), leg: ap.running ? ap.legs[ap.i].name : '-' }; }
    if (pen > ap.legWorst) ap.legWorst = pen;
    const b = ap.box;
    b.minX = Math.min(b.minX, tr.x); b.maxX = Math.max(b.maxX, tr.x); b.minZ = Math.min(b.minZ, tr.z); b.maxZ = Math.max(b.maxZ, tr.z);
  });
  return 'installed';
})()`;

// Waypoints inside the arena (see the level scenario's collision map), starting from TractorStart (9, -11).
const ROUTE = [
  { name: 'east lane', kind: 'goto', x: 12, z: -6 },
  { name: 'south-east', kind: 'goto', x: 11, z: 10 },
  { name: 'south-west', kind: 'goto', x: -1, z: 12 },
  { name: 'north-west', kind: 'goto', x: -2, z: -8 },
  { name: 'gate pad', kind: 'goto', x: 1.3, z: -12 },
  { name: 'back to start', kind: 'goto', x: 9, z: -10 },
  { name: 'settle', kind: 'stop', time: 1 },
];
const RAM_WALL = [
  // z 5.5: a stretch where the wall recedes ahead; at z ~3.5 a rock corner juts out and makes a pocket.
  { name: 'to east wall', kind: 'goto', x: 11, z: 5.5 },
  { name: 'ram east wall', kind: 'push', dx: 1, dz: 0, time: 2.5 },
  // A shallow angle, the way a player drives along a wall: slides past the bumps of the rocks.
  { name: 'scrape along the wall', kind: 'push', dx: 0.45, dz: 0.89, time: 1.5 },
  { name: 'rest at the wall', kind: 'stop', time: 0.3 },
];
// The far (west) wall: the tractor is in front of the rocks there, so a bucket sunk into them would show.
const RAM_FAR_WALL = [
  { name: 'to west wall', kind: 'goto', x: -1, z: 4 },
  { name: 'ram west wall', kind: 'push', dx: -1, dz: 0, time: 2.5 },
  { name: 'rest at the far wall', kind: 'stop', time: 0.3 },
];
const RAM_SHREDDER = [
  { name: 'shredder east side', kind: 'goto', x: 10.5, z: -1.9 },
  { name: 'ram shredder', kind: 'push', dx: -1, dz: 0, time: 2.5 },
  { name: 'rest at the shredder', kind: 'stop', time: 0.3 },
];
const RAM_CORNER = [
  { name: 'south-east corner', kind: 'goto', x: 11, z: 13 },
  { name: 'ram corner', kind: 'push', dx: 0.7, dz: 0.7, time: 3 },
  { name: 'rest in the corner', kind: 'stop', time: 1.2 },
];

export default async function drive(t) {
  await t.waitFor('window.__zm && window.__zm.tractor');
  await t.evaluate(INSTALL);
  const run = async (label, legs) => {
    await t.evaluate(`__ap.run(${JSON.stringify(legs)})`);
    await t.waitFor('!__ap.running', 180000);
    const results = await t.evaluate('__ap.results');
    for (const r of results) t.log(`${label} | ${r.name}: ${r.reason} at (${r.x}, ${r.z}) in ${r.t}s, moved ${r.moved}, max pen ${r.worst}`);
    t.check(results.every((r) => r.ok), `${label}: every leg finished (${results.filter((r) => r.ok).length}/${legs.length})`);
    return results;
  };
  /** Waits for `seconds` of game time (the clock advances by the clamped frame time). */
  const gameWait = async (seconds) => {
    const until = (await t.evaluate('__ap.clock')) + seconds;
    await t.waitFor(`__ap.clock >= ${until}`, 120000);
  };

  // Start: the joystick rests bottom-centre, the tractor sits on TractorStart.
  const start = await t.evaluate(`(() => { const s = cc.find('Level/Spots/TractorStart').worldPosition, tr = __zm.tractor;
    return { dx: tr.x - s.x, dz: tr.z - s.z, yaw: tr.yaw }; })()`);
  t.check(Math.hypot(start.dx, start.dz) < 1e-3 && Math.abs(start.yaw) < 1e-6, 'tractor starts on TractorStart facing +Z');
  await t.shot('start');

  // 1. Route through the arena.
  const route = await run('route', ROUTE);
  const odo = await t.evaluate('__zm.tractor.odometer');
  t.log(`route: ${odo.toFixed(1)} units driven in ${route.reduce((s, r) => s + r.t, 0).toFixed(1)} s game time`);

  // 2. Camera: at rest the focus sits on the tractor, the camera node shows the model's pose.
  await gameWait(1);
  const cam = await t.evaluate(`(() => { const c = __zm.camera, tr = __zm.tractor, n = cc.find('Main Camera');
    const p = n.worldPosition, e = n.eulerAngles;
    return { lag: Math.hypot(c.focus.x - tr.x, c.focus.z - tr.z), off: [p.x - c.focus.x, p.y - c.focus.y, p.z - c.focus.z],
             node: Math.hypot(p.x - c.position.x, p.y - c.position.y, p.z - c.position.z), euler: [e.x, e.y, e.z], zoom: c.zoom }; })()`);
  t.log(`camera: lag ${cam.lag.toFixed(4)}, offset (${cam.off.map((v) => v.toFixed(2)).join(', ')}), euler (${cam.euler.map((v) => v.toFixed(1)).join(', ')})`);
  t.check(cam.lag < 0.02, `camera settles on the tractor (lag ${cam.lag.toFixed(4)})`);
  t.check(Math.abs(cam.off[0] - 17.08) < 1e-3 && Math.abs(cam.off[1] - 24.15) < 1e-3 && Math.abs(cam.off[2] - 17.08) < 1e-3 && cam.node < 1e-3,
    'camera node at focus + offset (17.08, 24.15, 17.08)');
  t.check(Math.abs(cam.euler[0] + 45) < 0.01 && Math.abs(cam.euler[1] - 45) < 0.01, 'camera pitch -45, yaw 45');

  // 3. Ramming: straight into the east wall and along it, the far wall, the shredder, a corner.
  const wall = await run('wall', RAM_WALL);
  t.check(wall[2].moved > 1.5, `slides along the wall at a shallow angle (${wall[2].moved} units in 1.5 s)`);
  await t.shot('wall');
  await run('far wall', RAM_FAR_WALL);
  await t.shot('far-wall');
  await run('shredder', RAM_SHREDDER);
  await t.shot('shredder');
  const corner = await run('corner', RAM_CORNER);
  const probe = await t.evaluate('({ worst: __ap.worst, at: __ap.worstAt, nan: __ap.nan, box: __ap.box })');
  t.log(`max penetration ${probe.worst.toFixed(4)} at ${JSON.stringify(probe.at)}; tractor stayed in x ${probe.box.minX.toFixed(2)}..${probe.box.maxX.toFixed(2)}, z ${probe.box.minZ.toFixed(2)}..${probe.box.maxZ.toFixed(2)}`);
  t.check(probe.worst <= MAX_PENETRATION, `penetration into obstacles never above ${MAX_PENETRATION} (max ${probe.worst.toFixed(4)})`);
  t.check(!probe.nan, 'no NaN in the tractor state');
  t.check(probe.box.minX > -8 && probe.box.maxX < 17 && probe.box.minZ > -16 && probe.box.maxZ < 19, 'tractor stayed inside the arena');
  const cornerRest = corner[corner.length - 1];
  t.check(corner[1].moved < 3 * 3.6 && cornerRest.ok, `the corner holds the tractor (moved ${corner[1].moved} while ramming for 3 s)`);

  // 4. Tier zoom through the event bus: T2 pulls the camera out x1.2 over 0.5 s, T1 brings it back.
  await t.evaluate(`__zm.events.emit('tierChanged', { tier: 2 })`);
  await gameWait(0.7);
  const zoomed = await t.evaluate(`(() => { const c = __zm.camera; return { zoom: c.zoom, dy: c.position.y - c.focus.y }; })()`);
  t.check(Math.abs(zoomed.zoom - 1.2) < 1e-6 && Math.abs(zoomed.dy - 24.15 * 1.2) < 1e-3, `tierChanged 2 zooms the camera out to x1.2 (zoom ${zoomed.zoom.toFixed(3)})`);
  await t.shot('zoom-t2');
  await t.evaluate(`__zm.events.emit('tierChanged', { tier: 1 })`);
  await gameWait(0.7);
  t.check(Math.abs((await t.evaluate('__zm.camera.zoom')) - 1) < 1e-6, 'tierChanged 1 brings the zoom back to 1');

  // 5. Real touches. Area coordinates (origin at the screen centre, design units) -> client CSS px.
  await t.evaluate(`(() => { __zm.input.release(); __zm.tractor.place(5, 8, 0); __zm.camera.snap(5, 0, 8); })()`);
  await gameWait(0.3);
  const view = await t.evaluate(`(() => { const r = cc.game.canvas.getBoundingClientRect(), v = cc.view.getVisibleSize(),
    a = cc.find('Canvas/Joystick').getComponent(cc.js.getClassByName('cc.UITransform'));
    return { left: r.left, top: r.top, width: r.width, height: r.height, vw: v.width, vh: v.height, aw: a.width, ah: a.height }; })()`);
  t.log(`screen ${view.width}x${view.height} px shows ${view.vw.toFixed(0)}x${view.vh.toFixed(0)} design units; touch area ${view.aw.toFixed(0)}x${view.ah.toFixed(0)}`);
  t.check(Math.abs(view.aw - view.vw) < 1 && Math.abs(view.ah - view.vh) < 1, 'joystick touch area covers the whole screen');
  const client = (ax, ay) => ({ x: view.left + (ax / view.vw + 0.5) * view.width, y: view.top + (0.5 - ay / view.vh) * view.height });
  const state = () => t.evaluate(`(() => { const j = __zm.joystick, b = cc.find('Canvas/Joystick/Base').position, k = cc.find('Canvas/Joystick/Base/Knob').position,
    tr = __zm.tractor, i = __zm.input;
    return { held: j.isHeld, base: { x: j.base.x, y: j.base.y }, knob: { x: j.knob.x, y: j.knob.y }, stick: { x: j.stick.x, y: j.stick.y },
      drawn: { x: b.x, y: b.y, kx: k.x, ky: k.y }, input: { x: i.x, z: i.z }, tractor: { x: tr.x, z: tr.z, yaw: tr.yaw, speed: tr.speed } }; })()`);
  const rest = { x: 0, y: -view.vh / 2 + 300 };

  // Finger down away from the resting base: the base jumps under the finger.
  const p0 = { x: -200, y: -150 };
  let c = client(p0.x, p0.y);
  await t.touch('touchStart', c.x, c.y);
  await t.frames(3);
  let s = await state();
  t.check(s.held && Math.hypot(s.base.x - p0.x, s.base.y - p0.y) < 3, `touch: the base jumps under the finger (${s.base.x.toFixed(0)}, ${s.base.y.toFixed(0)})`);
  t.check(Math.hypot(s.drawn.x - s.base.x, s.drawn.y - s.base.y) < 1e-3, 'touch: the view draws the base where the model has it');

  // Drag straight up past the radius: full deflection, and the tractor heads away from the camera (-X -Z).
  for (const dy of [80, 160, 240, 320]) {
    c = client(p0.x, p0.y + dy);
    await t.touch('touchMove', c.x, c.y);
    await t.frames(1);
  }
  await t.frames(2);
  s = await state();
  t.check(Math.abs(s.stick.x) < 0.02 && Math.abs(s.stick.y - 1) < 0.02 && Math.abs(s.knob.y - 220) < 1,
    `drag up: stick (${s.stick.x.toFixed(2)}, ${s.stick.y.toFixed(2)}), knob clamped at the radius (${s.knob.y.toFixed(0)})`);
  t.check(Math.abs(s.input.x + Math.SQRT1_2) < 0.03 && Math.abs(s.input.z + Math.SQRT1_2) < 0.03,
    `drag up = away from the camera: input (${s.input.x.toFixed(2)}, ${s.input.z.toFixed(2)})`);
  const before = s.tractor;
  await gameWait(1.8);
  s = await state();
  const heading = { x: Math.sin(s.tractor.yaw), z: Math.cos(s.tractor.yaw) };
  const moved = Math.hypot(s.tractor.x - before.x, s.tractor.z - before.z);
  t.check(heading.x < -0.69 && heading.z < -0.69 && moved > 2, `touch drive: tractor turned to (${heading.x.toFixed(2)}, ${heading.z.toFixed(2)}) and drove ${moved.toFixed(1)} units`);
  await t.shot('touch-hold');

  // Finger up: stick zero at once, the joystick glides back to rest, the tractor stops.
  await t.touch('touchEnd', c.x, c.y);
  await t.frames(3);
  s = await state();
  t.check(!s.held && s.stick.x === 0 && s.stick.y === 0 && s.input.x === 0 && s.input.z === 0, 'release: stick and input back to zero');
  await gameWait(0.8);
  s = await state();
  t.check(Math.hypot(s.base.x - rest.x, s.base.y - rest.y) < 1 && Math.hypot(s.knob.x, s.knob.y) < 1 && s.tractor.speed === 0,
    `release: the joystick glides back to rest (${s.base.x.toFixed(1)}, ${s.base.y.toFixed(1)}), the tractor stops`);
  await t.shot('touch-released');

  // Finger down on the resting base: the base stays, the knob follows the finger.
  c = client(rest.x + 60, rest.y);
  await t.touch('touchStart', c.x, c.y);
  await t.frames(2);
  c = client(rest.x + 150, rest.y);
  await t.touch('touchMove', c.x, c.y);
  await t.frames(3);
  s = await state();
  const expected = (150 / 220 - 0.08) / 0.92;
  t.check(Math.hypot(s.base.x - rest.x, s.base.y - rest.y) < 1 && Math.abs(s.stick.x - expected) < 0.03 && Math.abs(s.stick.y) < 0.03,
    `touch on the resting base: base stays, stick (${s.stick.x.toFixed(2)}, ${s.stick.y.toFixed(2)}) ~ (${expected.toFixed(2)}, 0)`);
  await t.touch('touchEnd', c.x, c.y);
  await t.frames(2);

  const fps = await t.evaluate(`new Promise((ok) => { const d = cc.director, f0 = d.getTotalFrames(), t0 = performance.now();
    setTimeout(() => ok((d.getTotalFrames() - f0) * 1000 / (performance.now() - t0)), 1500); })`);
  const draws = await t.evaluate('cc.director.root.device.numDrawCalls');
  t.log(`fps ${fps.toFixed(1)}, draw calls ${draws}`);
}
