// The coin counter's number, draw calls and the dynamic atlas (M7). The plate and the icon are packed
// into the engine's dynamic atlas and batch with the joystick. The number uses a bitmap font
// (assets/fonts/hud-digits, tools/art/font.mjs): its page is packed once and joins that batch, and a
// new number only moves quads. Checked: at rest the number costs no draw call; while the number
// changes every frame (CHANGES times) no GPU texture is made, the atlas keeps its pages and the draw
// calls stay put. For comparison the same number in the system font (what it was before M7), per
// cache mode: NONE draws its own texture (remade on every change), CHAR its letter atlas, BITMAP
// packs it into the dynamic atlas on every change and never gets the space back: once page 0 is
// full, every change makes a new 2048² page.
//
//   node tools/check-html.mjs <html|url> --scenario hud-atlas [--gpu]

const CHANGES = 1500;

const SETUP = `(() => {
  const label = cc.find('Canvas/Hud/CoinHud/Plate/Amount').getComponent(cc.js.getClassByName('cc.Label'));
  const mgr = cc.internal.dynamicAtlasManager;
  window.__hudAtlas = { label, mgr, font: label.font, mode: label.cacheMode };
  const bitmap = label.font instanceof cc.js.getClassByName('cc.BitmapFont');
  return { font: label.font ? label.font.name + (bitmap ? ' (bitmap font)' : '') : 'system ' + label.fontFamily,
    atlas: mgr.enabled, pages: mgr.atlasCount, textureSize: mgr.textureSize, maxPages: mgr.maxAtlasCount };
})()`;

/**
 * Changes the number once a frame, CHANGES times; counts the GPU textures made meanwhile and among them
 * the dynamic atlas' pages (textures of its page size: the engine's private fields are mangled in the
 * build, the gfx texture info is not), the change that made the first page (page 0 was full); draw
 * calls before and after that, frame times. The shelf of page 0 is read where the fields keep their
 * names (the editor preview).
 */
const CHURN = `new Promise((done) => {
  const { mgr } = __hudAtlas, hud = __zm.coinHud, device = cc.director.root.device, size = mgr.textureSize;
  let n = 0, pages = 0, textures = 0, firstFull = -1, last = performance.now();
  const frameMs = [], draws = [], createTexture = device.createTexture;
  device.createTexture = function (info, ...rest) {
    textures++;
    if (info && info.width === size && info.height === size) { pages++; if (firstFull < 0) firstFull = n; }
    return createTexture.call(this, info, ...rest);
  };
  const tick = () => {
    const now = performance.now();
    frameMs.push(now - last); last = now;
    draws.push(device.numDrawCalls);
    if (n >= ${CHANGES}) {
      cc.director.off(cc.Director.EVENT_AFTER_UPDATE, tick);
      device.createTexture = createTexture;
      const sorted = frameMs.slice(5).sort((a, b) => a - b), page0 = mgr._atlases && mgr._atlases[0];
      const range = (list) => list.length ? Math.min(...list) + '..' + Math.max(...list) : '-';
      done({ textures, pages, firstFull, atlasCount: mgr.atlasCount, page0: page0 ? page0._y + ' of ' + page0._height : null,
        drawsBefore: range(draws.slice(5, firstFull > 0 ? firstFull : draws.length)), drawsAfter: range(firstFull > 0 ? draws.slice(firstFull + 2) : []),
        frameP50: sorted[Math.floor(sorted.length / 2)], frameP95: sorted[Math.floor(sorted.length * 0.95)], frameMax: sorted[sorted.length - 1] });
      return;
    }
    hud.show(12345 + (++n) * 7, false); // 5-6 digits, a new string every frame
  };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, tick);
})`;

const describe = (c) => `${c.textures} GPU textures made, ${c.pages} of them atlas pages (${c.atlasCount} page(s) at the end); ` +
  `page 0 ${c.firstFull < 0 ? 'never full' : `full after ${c.firstFull} changes`}${c.page0 ? ` (its shelf at ${c.page0})` : ''}; draw calls ${c.drawsBefore}` +
  `${c.firstFull < 0 ? '' : ` while it had room, ${c.drawsAfter} after`}; frame ${c.frameP50.toFixed(1)} ms p50, ${c.frameP95.toFixed(1)} p95, ${c.frameMax.toFixed(1)} max`;

export default async function hudAtlas(t) {
  await t.waitFor('!!(window.__zm && window.__zm.coinHud)');
  const setup = await t.evaluate(SETUP);
  t.log(`number: ${setup.font}; dynamic atlas ${setup.atlas ? 'on' : 'off'}, ${setup.pages} page(s) of ${setup.textureSize}², at most ${setup.maxPages}`);
  const draws = async () => {
    await t.frames(4);
    return t.evaluate('cc.director.root.device.numDrawCalls');
  };
  const showNumber = (on) => t.evaluate(`cc.find('Canvas/Hud/CoinHud/Plate/Amount').active = ${on}`);
  await showNumber(false);
  const without = await draws();
  await showNumber(true);

  // The scene's number.
  const scene = await draws();
  const churn = await t.evaluate(CHURN);
  t.log(`scene's number: ${scene} draw calls at rest (${without} without it); ${CHANGES} changes: ${describe(churn)}`);
  t.check(scene === without, `the number costs no draw call at rest (${scene} with it, ${without} without)`);
  t.check(churn.textures === 0 && churn.pages === 0, `changing the number makes no texture and no atlas page (${churn.textures} textures, ${churn.pages} pages)`);
  t.check(churn.drawsBefore === `${scene}..${scene}`, `the draw calls stay at ${scene} while the number changes (${churn.drawsBefore})`);

  // The same number in the system font, per cache mode (0 NONE, 1 BITMAP, 2 CHAR).
  await t.evaluate('__hudAtlas.label.font = null');
  const modes = {};
  for (const [mode, name] of [[0, 'NONE'], [1, 'BITMAP'], [2, 'CHAR']]) {
    await t.evaluate(`__hudAtlas.label.cacheMode = ${mode}`);
    modes[name] = await draws();
  }
  t.log(`system font: ${modes.NONE} draw calls at rest in NONE, ${modes.BITMAP} in BITMAP, ${modes.CHAR} in CHAR`);
  for (const [mode, name] of [[0, 'NONE'], [1, 'BITMAP']]) {
    await t.evaluate(`__hudAtlas.label.cacheMode = ${mode}`);
    await t.frames(4);
    t.log(`system font, ${name}, ${CHANGES} changes: ${describe(await t.evaluate(CHURN))}`);
  }

  // Back to the scene's setup.
  await t.evaluate('(() => { const h = __hudAtlas; h.label.cacheMode = h.mode; h.label.font = h.font; __zm.coinHud.show(__zm.purse.total, false); })()');
  t.check((await draws()) === scene, 'the scene\'s number is back');
  await t.shot('hud');
}
