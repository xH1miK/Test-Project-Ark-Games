// Mute button check (S3), with REAL touches (DevTools input events, as a finger) on the packed file:// page and the
// audio output tapped (lib/audio-tap.mjs). Run in both browser modes:
//   node tools/check-html.mjs dist/ZombieMiner.html --scenario mute
//   node tools/check-html.mjs dist/ZombieMiner.html --scenario mute --locked-audio
// Checks: the button is on the page, in the bottom-left corner, its touch area is a finger's size (>= 44 CSS px) and the
// icon is the speaker; a tap mutes (the slash icon, the music falls silent) and a second tap unmutes (the music is
// back); in the locked mode the very first tap on the button is the gesture that unlocks the audio and then mutes; a tap
// starts no stick and moves nothing (the full-screen joystick lets it through); sliding off the button before letting go
// is no tap; a touch elsewhere still steers; a SECOND finger on the button works while the first steers, and the stick
// keeps its finger; the button costs no draw call (it shares the UI batch, both icons); the UI layering still holds.

import { checkUiOnTop } from './lib/ui-layers.mjs';
import { TAP_SCRIPT } from './lib/audio-tap.mjs';

export const initScript = TAP_SCRIPT;

/** The page rectangle (CSS px) of a UI node, through the UI camera; and the part of the page the game shows. */
const RECT = (path) => `(() => {
  const ui = cc.find('Canvas/Camera').getComponent(cc.js.getClassByName('cc.Camera')), UIT = cc.js.getClassByName('cc.UITransform');
  const canvas = cc.game.canvas, rect = canvas.getBoundingClientRect();
  const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
  const box = cc.find('${path}').getComponent(UIT).getBoundingBoxToWorld(), lo = new cc.Vec3(), hi = new cc.Vec3();
  ui.worldToScreen(new cc.Vec3(box.x, box.y, 0), lo); ui.worldToScreen(new cc.Vec3(box.x + box.width, box.y + box.height, 0), hi);
  const r = { left: rect.left + lo.x * sx, right: rect.left + hi.x * sx, top: rect.top + (canvas.height - hi.y) * sy, bottom: rect.top + (canvas.height - lo.y) * sy };
  r.cx = (r.left + r.right) / 2; r.cy = (r.top + r.bottom) / 2; r.w = r.right - r.left; r.h = r.bottom - r.top;
  r.shown = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
  r.framed = rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1;
  return r;
})()`;

export default async function (t) {
  const locked = t.lockedAudio;
  const peek = () => t.evaluate('window.__audio.peek()');
  const reset = () => t.evaluate('window.__audio.reset(), true');
  const sound = (expr) => t.evaluate(`__zm.sound.${expr}`);
  const stick = () => t.evaluate('({ held: __zm.joystick.isHeld, x: __zm.joystick.stick.x, z: __zm.joystick.stick.y, inputX: __zm.input.x, inputZ: __zm.input.z })');
  const frameName = () => t.evaluate("cc.find('Canvas/Hud/MuteButton/Icon').getComponent(cc.Sprite).spriteFrame.name");
  const tap = async (x, y, hold = 90) => {
    await t.touch('touchStart', x, y);
    await t.sleep(hold);
    await t.touch('touchEnd', x, y);
  };
  t.log(`mode: ${locked ? 'locked until a gesture' : 'autoplay allowed'}`);

  // 1. Where it is, how big, what it shows.
  await t.waitFor('!!(__zm.muteButton && __zm.sound)');
  await t.frames(3);
  const area = await t.evaluate(RECT('Canvas/Hud/MuteButton'));
  const icon = await t.evaluate(RECT('Canvas/Hud/MuteButton/Icon'));
  const shown = area.shown;
  t.log(`touch area on the page: x ${area.left.toFixed(0)}..${area.right.toFixed(0)}, y ${area.top.toFixed(0)}..${area.bottom.toFixed(0)} (${area.w.toFixed(0)} x ${area.h.toFixed(0)} CSS px); icon ${icon.w.toFixed(0)} px; the game shows x ${shown.left.toFixed(0)}..${shown.right.toFixed(0)}, y ${shown.top.toFixed(0)}..${shown.bottom.toFixed(0)}`);
  if (area.framed) {
    t.log('the editor preview frames the game larger than the page: the layout is checked on the packed HTML');
  } else {
    t.check(area.left >= shown.left && area.right <= shown.right && area.top >= shown.top && area.bottom <= shown.bottom, 'the button is fully on screen');
    t.check(area.left - shown.left < 0.1 * (shown.right - shown.left) && shown.bottom - area.bottom < 0.1 * (shown.bottom - shown.top), 'the button sits in the bottom-left corner');
    t.check(area.w >= 44 && area.h >= 44, `its touch area is a finger's size (${area.w.toFixed(0)} x ${area.h.toFixed(0)} CSS px, at least 44)`);
    t.check(Math.abs(icon.cx - area.cx) < 1 && Math.abs(icon.cy - area.cy) < 1 && icon.w < area.w, 'the icon is centred in its touch area and smaller than it');
  }
  t.check((await frameName()) === 'sound_on', `the icon is the speaker (${await frameName()})`);
  t.check(!(await sound('muted')), 'the sound starts on');
  const draws = async () => (await t.frames(2), t.evaluate('cc.director.root.device.numDrawCalls'));
  const drawsWith = await draws();
  await t.evaluate("cc.find('Canvas/Hud/MuteButton').active = false, true");
  const drawsWithout = await draws();
  await t.evaluate("cc.find('Canvas/Hud/MuteButton').active = true, true");
  await t.frames(2);
  t.check(drawsWith === drawsWithout, `the button costs no draw call (${drawsWith} with, ${drawsWithout} without: it joins the UI batch)`);
  await checkUiOnTop(t);

  // 2. The first tap. Locked: it is the gesture that wakes the audio, then it mutes. Autoplay: it just mutes.
  if (locked) {
    await t.sleep(600);
    t.check(!(await sound('unlocked')), 'locked: nothing sounds before the first touch');
  } else {
    await t.waitFor('__zm.sound.unlocked', 5000);
    await t.sleep(400);
    await reset();
    await t.sleep(200);
    t.check((await peek()).peak > 0.005, 'autoplay: the music is playing before the tap');
  }
  const gesturesBefore = await sound('gestures');
  await t.touch('touchStart', area.cx, area.cy);
  await t.sleep(120);
  const held = await stick();
  t.check(!held.held && held.x === 0 && held.z === 0, 'a finger on the button does not start the stick');
  await t.touch('touchEnd', area.cx, area.cy);
  await t.sleep(700);
  t.check((await sound('muted')) === true, 'a tap mutes');
  t.check((await sound('gestures')) > gesturesBefore, 'the tap counted as a gesture for the audio layer (it unlocks it where it must)');
  t.check((await frameName()) === 'sound_off', `the icon shows the slash (${await frameName()})`);
  await reset();
  await t.sleep(300);
  t.check((await peek()).peak < 0.002, `muted: silence (peak ${(await peek()).peak.toFixed(4)})`);
  const after = await stick();
  t.check(!after.held && after.inputX === 0 && after.inputZ === 0, 'the tap moved nothing');

  await tap(area.cx, area.cy);
  await t.sleep(800);
  t.check((await sound('muted')) === false, 'a second tap unmutes');
  t.check((await frameName()) === 'sound_on', `the icon is the speaker again (${await frameName()})`);
  await reset();
  await t.sleep(300);
  const back = await peek();
  t.check(back.peak > 0.005 && (await sound('unlocked')), `unmuted: the music is back (peak ${back.peak.toFixed(3)})`);

  // 3. Slide off before letting go: no tap, no stick.
  const [w, h] = t.size.split('x').map(Number);
  await t.touch('touchStart', area.cx, area.cy);
  await t.sleep(80);
  await t.touch('touchMove', w / 2, h / 2);
  await t.sleep(150);
  const slid = await stick();
  await t.touch('touchEnd', w / 2, h / 2);
  await t.sleep(400);
  t.check((await sound('muted')) === false, 'sliding off the button before letting go is no tap');
  t.check(!slid.held && slid.x === 0 && slid.z === 0, 'the slide did not steer either (the finger belongs to the button)');

  // 4. A touch elsewhere still steers.
  await t.touch('touchStart', w / 2, h * 0.6);
  await t.sleep(100);
  await t.touch('touchMove', w / 2 + 60, h * 0.6);
  await t.sleep(250);
  const steer = await stick();
  t.check(steer.held && Math.hypot(steer.x, steer.z) > 0.5, `a touch elsewhere still steers (stick ${steer.x.toFixed(2)}, ${steer.z.toFixed(2)})`);
  await t.touch('touchEnd', w / 2 + 60, h * 0.6);
  await t.sleep(300);
  t.check(!(await stick()).held, 'and lets go');

  // 5. A second finger on the button while the first one steers.
  const A = { x: w / 2, y: h * 0.6, id: 1 };
  await t.touchPoints('touchStart', [A]);
  await t.sleep(100);
  A.x += 60;
  await t.touchPoints('touchMove', [A]);
  await t.sleep(200);
  const one = await stick();
  const B = { x: area.cx, y: area.cy, id: 2 };
  await t.touchPoints('touchStart', [A, B]);
  await t.sleep(150);
  const two = await stick();
  await t.touchPoints('touchEnd', [B]); // lifts B only
  await t.sleep(700);
  const three = await stick();
  t.check(one.held && Math.hypot(one.x, one.z) > 0.5, 'the first finger steers');
  t.check(two.held && Math.hypot(two.x, two.z) > 0.5, 'the second finger on the button does not take the stick from the first');
  t.check((await sound('muted')) === true, 'the second finger\'s tap mutes while the first steers');
  t.check(three.held && Math.hypot(three.x, three.z) > 0.5, 'the stick keeps its finger after the tap');
  await t.touchPoints('touchEnd', [A]);
  await t.sleep(400);
  t.check(!(await stick()).held, 'lifting the first finger lets the stick go');
  await reset();
  await t.sleep(250);
  t.check((await peek()).peak < 0.002, 'muted through all that: silence');
  await tap(area.cx, area.cy);
  await t.sleep(700);
  t.check((await sound('muted')) === false, 'unmuted again');

  // 6. Both icons in the UI batch: no draw call either way.
  const drawsOn = await draws();
  await tap(area.cx, area.cy);
  await t.sleep(300);
  const drawsMuted = await draws();
  t.check(drawsOn === drawsMuted, `the slash icon costs no draw call either (${drawsOn} on, ${drawsMuted} muted)`);
  await tap(area.cx, area.cy);
  await t.sleep(300);
  t.check((await sound('muted')) === false, 'left unmuted');
}
