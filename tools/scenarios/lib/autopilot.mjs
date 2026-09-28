// In-page autopilot shared by the scenarios: drives the tractor through a list of legs by overriding
// the move input on every engine frame (EVENT_BEFORE_UPDATE), the way a player's stick would.
// Legs: { kind: 'goto', x, z, radius? } | { kind: 'push', dx, dz, time } | { kind: 'stop', time } |
// { kind: 'seek', target, radius?, stall? }, each with an optional timeout (s, default 20) and an
// optional `until`: the name of a condition in `__ap.until` that ends the leg early (built in: `full`,
// the bucket is full; `inZone`, the tractor's pivot is in the shredder's zone). A seek leg drives to
// the points `__ap.targets[target](leg, stalled)` gives (a scenario registers the function): asked
// again whenever a point is reached, passed or brings no headway for `stall` s (default 1.5; that
// point is handed back as `stalled`), the leg ends 'none left' on null. A scenario's own probes can
// raise `__ap.legWorst`, which is reported per leg. A leg's result also says how many balls the
// bucket held when it ended (`load`) and how many the shredder took from it during the leg (`sold`).
// Needs the ?qa hooks (window.__zm).
// tools/test/ball-world.mjs `driveLegs` runs the same legs on the pure models in Node.

export const AUTOPILOT = `(() => {
  if (window.__ap) return 'already';
  const zm = window.__zm;
  const ap = window.__ap = { legs: [], i: 0, t: 0, clock: 0, running: false, results: [], legWorst: 0, targets: {},
    until: { full: () => zm.bucket.full, inZone: () => zm.shredder.inZone } };
  /** Asks a seek leg's source for its next point; false when there is none. */
  const aim = (leg, stalled) => {
    const p = ap.targets[leg.target](leg, stalled);
    leg.picks++;
    if (!p) return false;
    leg.point = p; leg.x = p.x; leg.z = p.z; leg.fromX = zm.tractor.x; leg.fromZ = zm.tractor.z; leg.best = Infinity; leg.bestAt = ap.t;
    return true;
  };
  const begin = () => {
    const leg = ap.legs[ap.i];
    if (!leg) return;
    leg.fromX = zm.tractor.x; leg.fromZ = zm.tractor.z; leg.odo0 = zm.tractor.odometer; leg.picks = 0; leg.handed0 = zm.shredder.handedIn;
    if (leg.kind === 'seek' && !aim(leg, null)) finish(true, 'none left');
  };
  const finish = (ok, reason) => {
    const leg = ap.legs[ap.i], tr = zm.tractor;
    ap.results.push({ name: leg.name, ok, reason, x: +tr.x.toFixed(2), z: +tr.z.toFixed(2), t: +ap.t.toFixed(2),
      moved: +(tr.odometer - leg.odo0).toFixed(2), worst: +ap.legWorst.toFixed(4), picks: leg.picks,
      load: zm.bucket.count, sold: zm.shredder.handedIn - leg.handed0 });
    ap.i++; ap.t = 0; ap.legWorst = 0;
    if (ap.i >= ap.legs.length) { ap.running = false; zm.input.release(); } else begin();
  };
  ap.run = (legs) => { ap.legs = legs; ap.i = 0; ap.t = 0; ap.results = []; ap.legWorst = 0; ap.running = true; begin(); };
  cc.director.on(cc.Director.EVENT_BEFORE_UPDATE, () => {
    if (!ap.running) return;
    const leg = ap.legs[ap.i], tr = zm.tractor, radius = leg.radius || 1;
    if (leg.until && ap.until[leg.until]()) return finish(true, leg.until);
    if (leg.kind === 'goto' || leg.kind === 'seek') {
      let dx = leg.x - tr.x, dz = leg.z - tr.z, dist = Math.hypot(dx, dz);
      // At low FPS the tractor may step over the waypoint: done once it is behind.
      const passed = dx * (leg.x - leg.fromX) + dz * (leg.z - leg.fromZ) <= 0;
      if (leg.kind === 'goto') {
        if (dist <= radius) return finish(true, 'reached');
        if (passed) return finish(true, 'passed');
      } else {
        if (dist < leg.best - 0.25) { leg.best = dist; leg.bestAt = ap.t; }
        const stalled = ap.t - leg.bestAt > (leg.stall || 1.5);
        if (dist <= radius || passed || stalled) {
          if (!aim(leg, stalled ? leg.point : null)) return finish(true, 'none left');
          dx = leg.x - tr.x; dz = leg.z - tr.z; dist = Math.hypot(dx, dz);
        }
      }
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
  });
  return 'installed';
})()`;

/** Installs the autopilot (once per page load). */
export const installAutopilot = (t) => t.evaluate(AUTOPILOT);

/** Drives the legs and waits until they are done; returns the leg results. */
export async function driveLegs(t, legs, timeoutMs = 180000) {
  await t.evaluate(`__ap.run(${JSON.stringify(legs)})`);
  await t.waitFor('!__ap.running', timeoutMs);
  return t.evaluate('__ap.results');
}

/** Drives the legs, logs one line per leg and checks that every leg finished. Returns the leg results. */
export async function runLegs(t, label, legs) {
  const results = await driveLegs(t, legs);
  for (const r of results) t.log(`${label} | ${r.name}: ${r.reason} at (${r.x}, ${r.z}) in ${r.t}s, moved ${r.moved}, worst ${r.worst}`);
  t.check(results.every((r) => r.ok), `${label}: every leg finished (${results.filter((r) => r.ok).length}/${legs.length})`);
  return results;
}

/** Waits for `seconds` of game time (the autopilot clock advances by the clamped frame time). */
export async function gameWait(t, seconds) {
  const until = (await t.evaluate('__ap.clock')) + seconds;
  await t.waitFor(`__ap.clock >= ${until}`, 120000);
}
