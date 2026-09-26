# Промпты для ChatGPT (GPT-image)

Как генерировать:
- **Одна картинка на один чат-запрос**, формат PNG. Если фон получился не прозрачный, допиши «transparent background, PNG».
- Сохраняй исходники в `C:\dev\Test-Project-Ark-Games\art-src\` под именами из таблицы (пока проекта нет, можно в `Downloads\art-src`).
- Ресайз, обрезку и сжатие в WebP делаю я скриптом, исходники нужны большими (1024).
- Из 2–4 вариантов выбирай тот, что лучше читается **маленьким**: иконка монеты на экране будет около 60 px.

**Общий стиль.** Эту фразу добавляй в конец каждого промпта:

> casual mobile game UI asset, bold readable shapes, soft gradients, glossy highlight, subtle dark outline, centered, transparent background, no text, no watermark

| Файл | Промпт |
|---|---|
| `coin.png` | Shiny gold coin icon seen from the front, thick raised rim, embossed miner helmet emblem in the middle, warm yellow-orange palette |
| `coin_plate.png` | Wide horizontal pill-shaped UI panel, dark navy-brown fill with a thin golden inner border, empty inside, aspect ratio about 3:1 |
| `pad_upgrade.png` | Rounded rectangular floor badge in saturated purple with a light lavender bevel, a white bulldozer/tractor silhouette icon on the left third, the right two thirds empty for a price label, top-down flat view |
| `pad_unlock.png` | Long rounded rectangular floor banner in saturated purple with a light lavender bevel, a white padlock icon on the left, the rest empty for a price label, top-down flat view |
| `joystick_base.png` | Circular joystick base for a mobile game: semi-transparent white ring with a soft inner glow, flat, perfectly round |
| `joystick_knob.png` | Circular joystick knob: solid white glossy disc with a soft drop shadow, perfectly round |
| `sound_on.png` | White speaker icon with two sound waves, rounded chunky shapes, thin dark outline |
| `sound_off.png` | White speaker icon crossed out with a red diagonal slash, rounded chunky shapes, thin dark outline |
| `win_ribbon.png` | Wide golden ribbon banner with folded ends, empty center for a title, celebratory style |

**Текстура пола.** Промпт без «общего стиля»:

> `ground.png`: Seamless tileable texture of a dark purple-gray cave stone floor, stylized hand-painted game texture, large soft flat stones with subtle cracks and small pebbles, low contrast, even top-down lighting, no shadows, no perspective, square 1024x1024

Если стыки окажутся заметными, сделаю бесшовную версию скриптом или процедурно.
