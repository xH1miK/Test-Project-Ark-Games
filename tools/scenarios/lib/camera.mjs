// Camera helpers shared by the scenarios: park the camera rig on a ground point (it stops following
// the tractor) with an optional field of view, and hand it back. Needs the ?qa hooks (window.__zm).

/** Freezes the camera rig on a ground point (the rig stops following the tractor); fov optional. */
export const freezeCamera = (x, z, fov = 45) => `(() => { const c = __zm.camera; c.update = () => {}; c.snap(${x}, 0, ${z});
  cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = ${fov}; })()`;

/**
 * Parks the camera over a ground point with a field of view and puts the camera node there at once,
 * so it works while the game is paused too (cc.director.pause(): rendering goes on, lateUpdate does not).
 */
export const parkCamera = (x, z, fov) => `(() => { const c = __zm.camera; c.update = () => {}; c.snap(${x}, 0, ${z});
  const node = cc.find('Main Camera'); node.setPosition(c.position.x, c.position.y, c.position.z);
  node.getComponent(cc.js.getClassByName('cc.Camera')).fov = ${fov}; })()`;

/** The rig follows the tractor again, at the normal field of view. */
export const RELEASE_CAMERA = `(() => { const c = __zm.camera, tr = __zm.tractor; delete c.update; c.snap(tr.x, 0, tr.z);
  cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = 45; })()`;

/** Sets the main camera's field of view (the rig keeps following). */
export const setFov = (fov) => `cc.find('Main Camera').getComponent(cc.js.getClassByName('cc.Camera')).fov = ${fov}`;

/** Frames per second over `ms` of real time. */
export const FPS = (ms) => `new Promise((ok) => { const d = cc.director, f0 = d.getTotalFrames(), t0 = performance.now();
  setTimeout(() => ok((d.getTotalFrames() - f0) * 1000 / (performance.now() - t0)), ${ms}); })`;

/** Parks the camera on a point, takes a shot, hands the camera back. */
export async function closeUp(t, name, x, z, fov) {
  await t.evaluate(freezeCamera(x, z, fov));
  await t.frames(3);
  const file = await t.shot(name);
  await t.evaluate(RELEASE_CAMERA);
  await t.frames(2);
  return file;
}
