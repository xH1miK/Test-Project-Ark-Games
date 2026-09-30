// Page script of the listening page (tools/audio/preview.mjs inlines it). Plain browser JS, no dependencies.
// The gains and intervals are the ones of the example's sound table (docs/reference-example-teardown.md §7).
const CLIPS = window.__CLIPS__;
const GAIN = { music: 0.3 * 0.35, engine: 0.040095, grind: 0.22, ball: 0.28, coin: 0.055, spend: 0.08, upgrade: 0.65, purchase: 0.65, gate: 0.55 };
const byName = Object.fromEntries(CLIPS.map((c) => [c.name, c]));
const roleNames = (role) => CLIPS.filter((c) => c.role === role).map((c) => c.name);
const rand = (a, b) => a + Math.random() * (b - a);
const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));

let ctx = null, master = null, run = 0;
const buffers = {};
const live = new Set(); // sources that may still be sounding

async function start() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = Number(document.getElementById('master').value);
  master.connect(ctx.destination);
  await ctx.resume();
  for (const c of CLIPS) {
    const bin = atob(c.b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buffers[c.name] = await ctx.decodeAudioData(bytes.buffer);
  }
  document.getElementById('start').textContent = 'Звук включён';
  document.getElementById('start').disabled = true;
  document.body.classList.add('ready');
}

function play(name, gain, loop = false) {
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.loop = loop;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(master);
  src.start();
  const voice = { src, g, stop() { try { src.stop(); } catch (e) { /* already stopped */ } live.delete(voice); } };
  live.add(voice);
  src.onended = () => live.delete(voice);
  return voice;
}

const ramp = (voice, to, seconds) => voice.g.gain.setTargetAtTime(to, ctx.currentTime, seconds / 3);

function stopAll() {
  run++;
  for (const v of [...live]) v.stop();
  for (const b of document.querySelectorAll('button.on')) b.classList.remove('on');
}

// A variant picker that never repeats the last one (a rule of the sound engine).
function picker(names) {
  let last = -1;
  return () => {
    let i;
    do i = Math.floor(Math.random() * names.length); while (i === last && names.length > 1);
    last = i;
    return names[i];
  };
}

// ---- scenes: the rules of the game played out --------------------------------------------------------
const scenes = {
  async drive(id) {
    const music = play('music', GAIN.music, true);
    await sleep(1);
    const engine = play('engine', 0, true);
    ramp(engine, GAIN.engine, 0.15);
    await sleep(5);
    if (id !== run) return;
    ramp(engine, 0, 0.15);
    await sleep(1.5);
    music.stop(); engine.stop();
  },
  async scoop(id) {
    const engine = play('engine', GAIN.engine, true);
    const next = picker(roleNames('ball'));
    for (let burst = 0; burst < 2; burst++) {
      for (let i = 0; i < 4; i++) {
        if (id !== run) return;
        play(next(), GAIN.ball * rand(0.8, 1.2));
        await sleep(rand(0.055, 0.125));
      }
      await sleep(0.8);
    }
    engine.stop();
  },
  async shred(id) {
    const grind = play('grind', 0, true);
    ramp(grind, GAIN.grind, 0.18);
    const next = picker(roleNames('coin'));
    await sleep(0.5);
    for (let i = 0; i < 10; i++) {
      if (id !== run) return;
      play(next(), GAIN.coin * rand(0.7, 1.3));
      await sleep(0.2);
    }
    ramp(grind, 0, 0.5);
    await sleep(0.8);
    grind.stop();
  },
  async pad(id) {
    const coins = roleNames('coin');
    const n = 14;
    for (let i = 0; i < n; i++) {
      if (id !== run) return;
      play(coins[Math.min(coins.length - 1, Math.floor((i / n) * coins.length))], GAIN.spend);
      await sleep(0.16 - (0.07 * i) / n);
    }
    await sleep(0.5);
    play('upgrade', GAIN.upgrade);
  },
  async finale(id) {
    play('purchase', GAIN.purchase);
    play('gate', GAIN.gate);
  },
  async all(id) {
    const music = play('music', GAIN.music, true);
    const engine = play('engine', 0, true);
    const grind = play('grind', 0, true);
    const balls = picker(roleNames('ball')), coins = picker(roleNames('coin')), pad = roleNames('coin');
    ramp(engine, GAIN.engine, 0.15);
    await sleep(2.5);
    for (let burst = 0; burst < 2; burst++) {
      for (let i = 0; i < 5; i++) { if (id !== run) return; play(balls(), GAIN.ball * rand(0.8, 1.2)); await sleep(rand(0.055, 0.125)); }
      await sleep(1);
    }
    ramp(grind, GAIN.grind, 0.18);
    for (let i = 0; i < 12; i++) { if (id !== run) return; play(coins(), GAIN.coin * rand(0.7, 1.3)); await sleep(0.2); }
    ramp(grind, 0, 0.5);
    await sleep(0.6);
    for (let i = 0; i < 12; i++) { if (id !== run) return; play(pad[Math.min(4, Math.floor(i / 2.5))], GAIN.spend); await sleep(0.16 - 0.005 * i); }
    await sleep(0.4);
    play('upgrade', GAIN.upgrade);
    await sleep(2.5);
    for (let i = 0; i < 12; i++) { if (id !== run) return; play(pad[Math.min(4, Math.floor(i / 2.5))], GAIN.spend); await sleep(0.14 - 0.004 * i); }
    ramp(engine, 0, 0.15);
    await sleep(0.4);
    play('purchase', GAIN.purchase);
    play('gate', GAIN.gate);
    await sleep(3);
    music.stop(); engine.stop(); grind.stop();
  },
};

// ---- page ------------------------------------------------------------------------------------------
document.getElementById('start').onclick = start;
document.getElementById('master').oninput = (e) => { if (master) master.gain.value = Number(e.target.value); };
document.getElementById('stop').onclick = stopAll;

for (const btn of document.querySelectorAll('[data-scene]')) {
  btn.onclick = async () => {
    if (!ctx) await start();
    stopAll();
    btn.classList.add('on');
    const id = run;
    await scenes[btn.dataset.scene](id);
    if (id === run) btn.classList.remove('on');
  };
}

const rows = document.getElementById('rows');
for (const c of CLIPS) {
  const gain = GAIN[c.role] ?? 1;
  const tr = document.createElement('tr');
  tr.innerHTML = '<td class="n">' + c.name + '</td><td>' + (c.loop ? 'цикл' : 'разовый') + '</td><td>' + c.dur.toFixed(2) + ' с</td><td>' + (c.bytes / 1024).toFixed(1) +
    ' КБ ' + c.format.toUpperCase() + '</td><td>' + gain + '</td><td class="b"></td>';
  const cell = tr.querySelector('.b');
  const mk = (label, g, loop) => {
    const b = document.createElement('button');
    b.textContent = label;
    let voice = null;
    b.onclick = async () => {
      if (!ctx) await start();
      if (voice) { voice.stop(); voice = null; b.classList.remove('on'); return; }
      voice = play(c.name, g, loop);
      if (loop) b.classList.add('on');
      else voice.src.onended = () => { live.delete(voice); voice = null; };
    };
    cell.appendChild(b);
  };
  mk(c.loop ? '▶ как в игре (цикл)' : '▶ как в игре', gain, c.loop);
  mk('▶ на полную', 1, false);
  rows.appendChild(tr);
}
