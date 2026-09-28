// Screen UI is drawn over everything else: the UI camera renders after every other camera and only
// clears depth; it alone sees the UI_2D layer; every node under the Canvas is on UI_2D and nothing
// outside it is; inside the Canvas the groups go Hud -> Joystick (a later sibling is drawn on top),
// so the joystick is the topmost thing on screen. Needs a page with the game running.

const FACTS = `(() => {
  const Camera = cc.js.getClassByName('cc.Camera');
  const UI_2D = cc.Layers.Enum.UI_2D;
  const canvas = cc.find('Canvas');
  const cameras = cc.director.getScene().getComponentsInChildren(Camera).filter((c) => c.enabledInHierarchy);
  const ui = cameras.find((c) => c.node.parent === canvas);
  const problems = [];
  if (!ui) return { problems: ['no UI camera under the Canvas'] };
  for (const c of cameras) {
    if (c === ui) continue;
    if (c.priority >= ui.priority) problems.push('camera ' + c.node.name + ' renders after the UI (priority ' + c.priority + ')');
    if (c.visibility & UI_2D) problems.push('camera ' + c.node.name + ' also draws the UI_2D layer');
  }
  if (ui.clearFlags & 1) problems.push('the UI camera clears the colour (it must keep the world image)'); // 1 = ClearFlagBit.COLOR
  if (ui.visibility !== UI_2D) problems.push('the UI camera sees more than UI_2D (visibility ' + ui.visibility + ')');
  const walk = (node, inCanvas) => {
    const inside = inCanvas || node === canvas;
    if (node !== ui.node && node !== canvas.parent) {
      if (inside && node.layer !== UI_2D) problems.push(node.name + ' is inside the Canvas but not on UI_2D');
      if (!inside && node.layer === UI_2D) problems.push(node.name + ' is on UI_2D outside the Canvas');
    }
    for (const child of node.children) walk(child, inside);
  };
  walk(cc.director.getScene(), false);
  const order = canvas.children.filter((n) => n !== ui.node).map((n) => n.name);
  if (order[order.length - 1] !== 'Joystick') problems.push('the joystick is not the last (topmost) Canvas child: ' + order.join(', '));
  if (order.indexOf('Hud') < 0 || order.indexOf('Hud') > order.indexOf('Joystick')) problems.push('no Hud group below the joystick: ' + order.join(', '));
  return { order, uiPriority: ui.priority, uiClear: ui.clearFlags, cameras: cameras.map((c) => c.node.name + ':' + c.priority), problems };
})()`;

/** Checks the screen-UI layering rules (see the header); logs the Canvas order and the cameras. */
export async function checkUiOnTop(t) {
  const facts = await t.evaluate(FACTS);
  t.log(`UI layers: cameras ${facts.cameras?.join(', ')}; Canvas groups ${facts.order?.join(' -> ')} (last = on top)`);
  for (const p of facts.problems) t.log(`UI layer problem: ${p}`);
  t.check(facts.problems.length === 0, 'screen UI is on top: UI camera last, UI_2D only, joystick the topmost Canvas group');
}
