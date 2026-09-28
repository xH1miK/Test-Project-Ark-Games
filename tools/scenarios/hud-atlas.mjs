// The coin counter's number and the dynamic atlas (M7 draw-call question). The plate and the icon
// are packed into the engine's dynamic atlas and batch with the joystick; the number (a Label) draws
// its own texture. Measured per cache mode of the number (NONE, BITMAP, CHAR): draw calls at rest;
// then, in BITMAP (the label's texture goes into the dynamic atlas), the number changes once a frame
// CHANGES times: the atlas's fill (its shelf cursor), how many atlas pages exist, how many were made
// and destroyed, draw calls and frame time as it goes. The scene's own cache mode is put back after.
//
//   node tools/check-html.mjs <html|url> --scenario hud-atlas [--gpu]

const CHANGES = 1500;

const SETUP = `(() => {
  const Label = cc.js.getClassByName('cc.Label');
  const label = cc.find('Canvas/Hud/CoinHud/Plate/Amount').getComponent(Label);
  const mgr = cc.internal.dynamicAtlasManager;
  window.__hudAtlas = { label, mgr, scene: label.cacheMode };
  return { scene: label.cacheMode, atlasEnabled: mgr.enabled, pages: mgr.atlasCount, textureSize: mgr.textureSize, maxPages: mgr.maxAtlasCount };
})()`;

/** The atlas pages: fill of each (shelf cursor y, next shelf), textures packed. */
const ATLAS = `(() => {
  const { mgr, label } = __hudAtlas;
  const frame = label.ttfSpriteFrame;
  return { pages: mgr._atlases.map((a) => ({ x: a._x, y: a._y, nextY: a._nextY, height: a._height, textures: a._count })),
    labelPacked: !!(frame && frame.original), canvas: frame && frame.texture ? [frame.texture.width, frame.texture.height] : null };
})()`;

/**
 * Changes the number once a frame, CHANGES times, sampling the atlas and the frame after each; counts
 * the GPU textures created meanwhile and how often the last atlas page was a new object.
 */
const CHURN = `new Promise((done) => {
  const { mgr, label } = __hudAtlas, hud = __zm.coinHud, device = cc.director.root.device;
  let n = 0, made = 0, dropped = 0, before = mgr.atlasCount, firstFull = -1, last = performance.now(), textures = 0, renewed = 0;
  let lastPage = mgr._atlases[mgr._atlases.length - 1];
  const createTexture = device.createTexture;
  device.createTexture = function (...args) { textures++; return createTexture.apply(this, args); };
  const frameMs = [], pagesAt = [], draws = [];
  const tick = () => {
    const pages = mgr.atlasCount, page = mgr._atlases[pages - 1];
    if (page !== lastPage && pages === before) renewed++;
    lastPage = page;
    if (pages > before) made += pages - before;
    if (pages < before) dropped += before - pages;
    before = pages;
    const now = performance.now();
    frameMs.push(now - last); last = now;
    draws.push(device.numDrawCalls);
    pagesAt.push(pages);
    const page0 = mgr._atlases[0];
    if (firstFull < 0 && pages > 1) firstFull = n;
    if (n >= ${CHANGES}) {
      cc.director.off(cc.Director.EVENT_AFTER_UPDATE, tick);
      device.createTexture = createTexture;
      const sorted = frameMs.slice(5).sort((a, b) => a - b);
      done({ changes: n, made, dropped, firstFull, textures, renewed, pagesMax: Math.max(...pagesAt), pagesEnd: pages,
        page0: page0 ? { y: page0._y, nextY: page0._nextY, height: page0._height, textures: page0._count } : null,
        drawsBefore: draws.slice(5, firstFull > 0 ? firstFull : draws.length), drawsAfter: firstFull > 0 ? draws.slice(firstFull + 2) : [],
        frameP50: sorted[Math.floor(sorted.length / 2)], frameP95: sorted[Math.floor(sorted.length * 0.95)], frameMax: sorted[sorted.length - 1] });
      return;
    }
    hud.show(12345 + (++n) * 7, false); // 5-6 digits, a new string every frame
  };
  cc.director.on(cc.Director.EVENT_AFTER_UPDATE, tick);
})`;

const range = (list) => (list.length ? `${Math.min(...list)}..${Math.max(...list)}` : '-');

export default async function hudAtlas(t) {
  await t.waitFor('!!(window.__zm && window.__zm.coinHud)');
  const setup = await t.evaluate(SETUP);
  t.log(`scene cache mode ${setup.scene} (0 NONE, 1 BITMAP, 2 CHAR); dynamic atlas ${setup.atlasEnabled ? 'on' : 'off'}, ${setup.pages} page(s) of ${setup.textureSize}², at most ${setup.maxPages}`);
  const draws = async () => {
    await t.frames(4);
    return t.evaluate('cc.director.root.device.numDrawCalls');
  };
  const byMode = {};
  for (const [mode, name] of [[0, 'NONE'], [1, 'BITMAP'], [2, 'CHAR']]) {
    await t.evaluate(`__hudAtlas.label.cacheMode = ${mode}`);
    byMode[name] = await draws();
  }
  await t.evaluate(`cc.find('Canvas/Hud/CoinHud/Plate/Amount').active = false`);
  const noNumber = await draws();
  await t.evaluate(`cc.find('Canvas/Hud/CoinHud/Plate/Amount').active = true`);
  t.log(`draw calls at rest: number NONE ${byMode.NONE}, BITMAP ${byMode.BITMAP}, CHAR ${byMode.CHAR}; without the number ${noNumber}`);

  await t.evaluate('__hudAtlas.label.cacheMode = 0');
  await t.frames(4);
  const none = await t.evaluate(CHURN);
  t.log(`NONE, ${none.changes} changes (one a frame): ${none.textures} GPU textures created; draw calls ${range(none.drawsBefore)}; frame ${none.frameP50.toFixed(1)} ms p50, ${none.frameP95.toFixed(1)} p95, ${none.frameMax.toFixed(1)} max`);
  await t.evaluate('__hudAtlas.label.cacheMode = 1');
  await t.frames(4);
  t.log(`BITMAP at rest: ${JSON.stringify(await t.evaluate(ATLAS))}`);
  const churn = await t.evaluate(CHURN);
  const after = await t.evaluate(ATLAS);
  t.log(`BITMAP, ${churn.changes} changes (one a frame): page 0 full after ${churn.firstFull < 0 ? 'never' : `${churn.firstFull} changes`}; ` +
    `pages made ${churn.made}, destroyed ${churn.dropped}, last page renewed in ${churn.renewed} frames, ${churn.textures} GPU textures created, at most ${churn.pagesMax} pages at once; page 0 cursor y ${churn.page0?.y} of ${churn.page0?.height}, ${churn.page0?.textures} texture(s) in it`);
  t.log(`BITMAP draw calls while page 0 had room ${range(churn.drawsBefore)}, after ${range(churn.drawsAfter)}; frame ${churn.frameP50.toFixed(1)} ms p50, ${churn.frameP95.toFixed(1)} p95, ${churn.frameMax.toFixed(1)} max`);
  t.log(`atlas after: ${JSON.stringify(after)}`);

  await t.evaluate(`__hudAtlas.label.cacheMode = __hudAtlas.scene`);
  await t.evaluate('__zm.coinHud.show(__zm.purse.total, false)');
  t.check(true, 'measured');
}
