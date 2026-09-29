// Builds the listening page dist/audio-preview/index.html from assets/audio (run make-sounds.mjs first): every clip
// embedded, each playable at its game gain or at full scale, and scripted scenes that play the rules of the game.
//   node tools/audio/preview.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CLIPS } from './sounds.mjs';
import { OUT_DIR } from './make-sounds.mjs';

const clips = CLIPS.map((c) => {
  const bytes = readFileSync(`${OUT_DIR}/${c.name}.${c.format}`);
  // WAV: samples / rate; MP3 (gapless tag): 12 s by construction of the music loop.
  const dur = c.format === 'wav' ? (bytes.length - 44) / 2 / c.rate : 12;
  return { name: c.name, role: c.role, loop: !!c.loop, format: c.format, bytes: bytes.length, dur, b64: bytes.toString('base64') };
});
const page = readFileSync(new URL('./preview-page.js', import.meta.url), 'utf8');
const total = clips.reduce((a, c) => a + c.bytes, 0);

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zombie Miner: звуки</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f1; --fg: #22201c; --dim: #736e63; --card: #fff; --line: #ddd8cb; --accent: #b7791f; --on: #2f855a; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1a17; --fg: #ece8dc; --dim: #a39d8e; --card: #26241f; --line: #3a372f; --accent: #e0a94a; --on: #58c08a; } }
  body { margin: 0 auto; max-width: 860px; padding: 20px 16px 60px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; }
  p { color: var(--dim); margin: 4px 0 12px; }
  button { font: inherit; padding: 8px 14px; margin: 3px 4px 3px 0; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); cursor: pointer; }
  button:hover { border-color: var(--accent); } button.on { background: var(--on); color: #fff; border-color: var(--on); }
  button:disabled { opacity: .6; cursor: default; }
  #start { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  td { padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; } tr:last-child td { border-bottom: 0; }
  td.n { font-weight: 600; font-family: ui-monospace, monospace; } td.b { text-align: right; white-space: nowrap; }
  @media (max-width: 640px) { td.b { white-space: normal; } td:nth-child(3), td:nth-child(4) { display: none; } }
</style>
</head>
<body>
<h1>Zombie Miner: звуки этапа S1</h1>
<p>Все звуки синтезированы кодом (ничего не взято из примера); громкости и интервалы — из таблицы примера. Всего ${clips.length} файлов, ${(total / 1024).toFixed(0)} КБ.</p>
<div class="bar">
  <button id="start">Включить звук</button>
  <label>Общая громкость <input id="master" type="range" min="0" max="1" step="0.01" value="0.8"></label>
  <button id="stop">Стоп</button>
</div>

<h2>Сцены (правила игры: интервалы, варианты без повтора, разгон валов, шаги монет)</h2>
<p>Музыка 0,105 · мотор 0,04 · шредер 0,22 × скорость валов · щелчок 0,28 · монета 0,055 · оплата 0,08 · апгрейд и покупка 0,65 · ворота 0,55.</p>
<div>
  <button data-scene="drive">Езда: музыка + мотор</button>
  <button data-scene="scoop">Сбор шариков</button>
  <button data-scene="shred">Шредер + монеты в счётчик</button>
  <button data-scene="pad">Оплата площадки → апгрейд</button>
  <button data-scene="finale">Финал: покупка + ворота</button>
  <button data-scene="all">Весь забег (~25 с)</button>
</div>

<h2>Каждый звук</h2>
<p>«Как в игре» — с игровой громкостью (тихие звуки будут тихими: так у примера); «на полную» — без гейна, для оценки тембра.</p>
<table><tbody id="rows"></tbody></table>

<script>window.__CLIPS__ = ${JSON.stringify(clips)};</script>
<script>
${page}
</script>
</body>
</html>
`;
mkdirSync('dist/audio-preview', { recursive: true });
writeFileSync('dist/audio-preview/index.html', html);
console.log(`dist/audio-preview/index.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, ${clips.length} clips`);
