# Session handoff prompts

Prompts the user pastes into a new Claude Code session to continue the work. `CLAUDE.md` and Claude's project memory load automatically, so a prompt only sets the stage goal and the working rules.

Before a new session: open the project in Cocos Creator 3.8.8 first and wait for it to load — the MCP server lives inside the editor, and a session connects to it only at start.

## 2026-09-27 → stage "Core" (PLAN: Mon 28 – Tue 29.09)

```text
Продолжаем тестовое Royal Ark Games — плеебл Zombie Miner на Cocos Creator 3.8.8. Этап «Ядро» из docs/PLAN.md (пн 28 – вт 29.09); контрольная точка ср 30.09 — игра проходится от начала до конца.

Начало:
1. Прочитай docs/PLAN.md, docs/GDD.md, docs/reference-example-teardown.md, docs/UNITY_TO_COCOS.md и последние записи docs/AI_LOG.md (27.09: MCP, сборка в редакторе, свой пакер, проверка из file://).
2. Проверь MCP: вызови mcp__cocos__get_editor_state. Если инструментов cocos нет в сессии — сразу скажи, я переподключу через /mcp.
3. Предложи план этапа: 6–8 вех по порядку, у каждой — критерий «готово» и способ проверки. Дождись моего ок и иди по вехам.

Что входит (цифры — из GDD, живут в assets/scripts/core/Config.ts):
- Уровень: пол, скалы, шредер, ворота, места площадок — статичная раскладка в Main.scene через MCP; препятствия для трактора и шариков — статическая XZ-сетка.
- Камера (изометрия, следование со сглаживанием), плавающий джойстик, трактор T1: скорость, поворот, разгон/торможение, столкновения со статикой.
- Шарики: BallField (типизированные массивы, равномерная сетка, «сон») + BallRenderer (один динамический меш = 1 draw call, свой impostor-шейдер). Начни с ~1500 шариков и замерь FPS.
- Ковш (до 8 шариков, полный — толкает), сдача в шредер (+2 монеты за шарик), кошелёк и HUD-счётчик монет.
- Площадки, апгрейд, ворота и туториал — следующий этап, но архитектуру (Events, Config) закладывай под них.

Как работаем:
- Сцену и префабы меняй только через MCP; перед пачкой операций со сценой — git commit, после — сохранение сцены через MCP. Новый .ts — дождись компиляции редактором, потом добавляй компонент.
- После каждой вехи: запуск → автопрогон трактора скриптом (подмена вывода джойстика) → скриншоты → коммит → строка в AI_LOG с временем (что сделал AI, что человек, как проверено, что сломалось). Галочки в PLAN.
- Автопрогоны и замеры — в headless Edge: расширь tools/check-html.mjs сценарием автопилота (встроенная панель браузера не открывает file:// и ставит requestAnimationFrame на паузу, когда скрыта).
- После крупных ассетов меряй размер: node tools/build.mjs → node tools/pack/pack.mjs → node tools/check-html.mjs (цель ≤ 4,8 МБ).
- Модули движка — lean-набор. Нужен ещё модуль — скажи, включи через Editor.Profile и перемерь.
- Код и шейдеры примера не копируем — только поведение и цифры. Решения «на вкус» и изменения цифр GDD — через меня.
- Коммиты мелкие; пушить на GitHub — только когда скажу.
```
