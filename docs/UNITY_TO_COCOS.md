# Шпаргалка Unity → Cocos Creator 3.8

| Unity | Cocos Creator 3.8 |
|---|---|
| GameObject | `Node` |
| MonoBehaviour | `Component`: `@ccclass('Name') export class Name extends Component {}` |
| `[SerializeField]` / public-поле | `@property(Type)` (для массивов `@property([Type])`) |
| Awake / OnEnable / Start | `onLoad` / `onEnable` / `start` |
| Update / LateUpdate | `update(dt)` / `lateUpdate(dt)`: `dt` вместо `Time.deltaTime` |
| OnDisable / OnDestroy | `onDisable` / `onDestroy` |
| `transform.position` | `node.worldPosition` (чтение) / `node.setWorldPosition(...)`; локально `position` / `setPosition` |
| `transform.rotation` / `eulerAngles` | `node.worldRotation` (Quat) / `node.eulerAngles`, `setRotationFromEuler(x, y, z)` |
| `Instantiate(prefab)` | `const n = instantiate(prefab); parent.addChild(n);` |
| `Destroy(go)` | `node.destroy()` |
| `GetComponent<T>()` | `node.getComponent(T)` |
| `SetActive(false)` | `node.active = false` |
| Корутины / DOTween | `tween(node).to(0.3, { scale: v }, { easing: 'backOut' }).start()`; `this.scheduleOnce(fn, sec)` |
| `Resources.Load` | `resources.load('path', AudioClip, cb)`: файлы в `assets/resources` |
| ScriptableObject | TS-модуль с константами (`Config.ts`) или JSON-ассет |
| Layers + Culling Mask | `node.layer` + `Camera.visibility` (интерфейс на слое `UI_2D`) |
| Canvas + RectTransform | `Canvas` + `UITransform`; якоря через компонент `Widget` |
| TextMeshPro | `Label` (обводка: `enableOutline`) |
| Физика / коллайдеры | в этом проекте не используем: своя логика столкновений |
| `Input.touches` | `input.on(Input.EventType.TOUCH_START, cb, this)` |
| Shader + Material | `.effect` (YAML + GLSL) + `Material` |
| Build Settings → WebGL | Build panel → **Web Mobile** |
| Package Manager | Extension Manager (папка `extensions/`) |
| `.meta` с GUID | `.meta` с UUID: руками не трогаем |
| Play в редакторе | кнопка Preview открывает игру в браузере (`localhost:7456`) |

## Грабли

- **Правосторонняя система координат, Y вверх.** Камера смотрит вдоль **−Z**, а в Unity forward = +Z.
- `node.position` и `worldPosition` возвращают ссылку только для чтения. Менять значения через `setPosition(...)`.
- `Vec3` изменяемый, аллокации в `update` бьют по GC. Используй статические методы `Vec3.add(out, a, b)` и переиспользуемые временные векторы.
- У `AudioSource` нет pitch. Для разнообразия звука берём несколько вариантов клипа.
- Скрипт становится компонентом только после того, как редактор его скомпилирует (дождаться обновления ассетов).
- Имя в `@ccclass('...')` должно быть уникальным во всём проекте.

## Что узнали на ядре (M1–M7)

| Unity | Cocos Creator 3.8 | Где у нас |
|---|---|---|
| `Graphics.DrawMesh` / `CommandBuffer` с процедурным мешем | Своя модель render-scene без MeshRenderer: `root.createModel(renderer.scene.Model)`, `RenderingSubMesh` из своих `gfx.Buffer`, `model.initSubModel(0, mesh, material)`, `scene.addModel(model)` | `BallRenderer` |
| `Mesh.SetVertexBufferData` | `gfx.Buffer.update(data)`. Динамический поток — буфер `HOST \| DEVICE` (на iOS движок пересоздаёт такой буфер целиком, а не патчит), статический — `DEVICE`. Загрузка раз в кадр и только если что-то сдвинулось | `BallRenderer.render` |
| `MeshRenderer` + `Mesh.SetVertices` каждый кадр | `utils.createDynamicMesh` / `updateSubMesh`: по потоку на атрибут, буферы только GPU, при обновлении перезаливаются все атрибуты и копируются в CPU-копию меша — для 1500 шариков дорого | отказались в M4 |
| Shader Graph / HLSL + Material | `.effect`: YAML (techniques, passes, свойства с дефолтами) + GLSL в блоках `CCProgram`. Вид живёт в дефолтах эффекта, материал `.mtl` ничего не переопределяет | `BallImpostor.effect` |
| `SV_Depth` в пиксельном шейдере | `gl_FragDepth` (WebGL 2) / `gl_FragDepthEXT` через `#pragma extension([GL_EXT_frag_depth, __VERSION__ < 300, require])` (WebGL 1). Движок обрезан до `gfx-webgl`, так что у нас всегда WebGL 1 | импостеры шариков |
| — (трюк) | Импостер: квад, повёрнутый к камере, а сфера трассируется лучом во фрагментном шейдере (силуэт, нормаль, глубина). 1468 шариков = один draw call | M4 |
| Override ссылки из сцены на объект внутри экземпляра префаба | Ссылка снаружи экземпляра на узел внутри него хранится в сцене как `targetOverrides` в prefab info. Ставить через `scene:set-property` (массив `{ type: 'cc.Node', isArray: true, value: [...] }`); прямое присваивание из скрипта сцены override не записывает | `ShredderView.rollers` → `roll_*` у SM_Shred |
| Override свойства дочернего объекта префаба | `scene:set-property` на узле экземпляра → запись в `propertyOverrides`; сырое изменение из скрипта сцены — нет | смещение Tractor1 (M2) |
| Image Type = Sliced + Sprite Border | Sprite `type = SLICED`; границы 9-slice лежат в подмете sprite-frame картинки (`f9941`: `borderTop/Bottom/Left/Right`), ставятся через `save-asset-meta` | плашка монет |
| RectTransform anchors | `Widget` (отступы от краёв родителя). Отступы ставить последними и через `set-property`: ресайз узла в редакторе их переписывает | `Canvas/Hud` |
| CanvasScaler (Match Width Or Height) | `view.setDesignResolutionSize(w, h, ResolutionPolicy.FIXED_WIDTH)` на каждый `window-resize`: макет 1280×2276 целиком на экране, лишняя сторона растёт | `UiFit` + `fitFrame` |
| Sprite Atlas | Динамический атлас движка: спрайты не больше 512 px сами пакуются в страницу 2048² при первом рисовании, и UI идёт одним батчем. Упаковщик полочный и место не возвращает | плашка, иконка, джойстик |
| TextMeshPro (атлас шрифта) / legacy Text | `Label` с системным шрифтом рисует текст canvas'ом в свою текстуру: при каждой смене — новая GPU-текстура и свой draw call. `cacheMode` BITMAP кладёт её в динамический атлас, но после ~180 смен страница кончается, и дальше каждая смена создаёт новую страницу 2048². Для часто меняющихся цифр — **bitmap-шрифт** (`.fnt` + PNG): страница пакуется один раз, смена числа только двигает квады | цифра HUD, `tools/art/font.mjs` |
| `Time.timeScale = 0` | `director.pause()`: update и lateUpdate стоят, рендер идёт (кадры для снимков «на паузе»; камеру ставить руками) | сценарии `core-loop`, `long-run` |
| Script Execution Order | Один корень композиции (`GameRoot`) сам вызывает модели в нужном порядке. `Director.EVENT_BEFORE_UPDATE` / `EVENT_AFTER_UPDATE` — до и после всех update/lateUpdate кадра (сюда цепляются автопилот и проверки) | `GameRoot`, `tools/scenarios` |
| Unity Test Runner (EditMode) | Модели — чистый TS без `cc`: тесты и бенчмарки в Node (`node --test`, type stripping) | `tools/test`, `tools/bench` |
| World Space Canvas | `RenderRoot2D` на узле в мире (слой Default, рисует основная камера): спрайты и Label как в UI, лежит на земле поворотом −90° по X. Встроенный материал спрайта рисует без теста глубины — поверх трактора; нужен свой материал из `builtin-sprite` с depth test on / depth write off (`Materials/WorldSprite.mtl`) на Sprite и Label (`customMaterial`). Спрайт и цифры bitmap-шрифта из одного динамического атласа = 1 draw call на плашку | площадки, табличка над воротами (M8) |
| Добавить Text после настройки RectTransform | `addComponent(Label)` сбрасывает размер UITransform узла под строку по умолчанию: заданный до этого размер теряется (при Overflow = SHRINK шрифт ужимается). Размер ставить после Label или через `scene:set-property` | цифры площадок (M8) |
| Physics layers / «зона без объектов» | Своих коллайдеров нет: «чистая зона» площадки — прямоугольник в симуляции шариков, который выталкивает шарики у пола позиционно (гарантированный сдвиг за шаг), до толкателя-трактора | `BallField.addClearZone` (M8) |
| Prefab Variant / override материала у экземпляра | Экземпляр префаба в сцене в рантайме собирается из самого префаба: префаб попадает в сборку со всеми своими мешами, материалами и текстурами, а override лишь добавляет ссылки на чужие. Чтобы переиспользовать материалы и меши другой модели и не тащить свои копии — отвязанная копия (`unlinkPrefab`, override «запекаются» в узлы). Замер: связанный Tractor2 с подменой +985 КБ, отвязанный +75 КБ (только корпус) | `Tractor/Tier2` (M9) |
| DOTween `DOKill` / `Tween.Kill()` | `Tween.stopAllByTarget(node)`. `tween(node).stop()` создаёт новый пустой твин и ничего не останавливает. Твин, запущенный в `lateUpdate`, делает первый шаг в следующем кадре, и этот шаг считается нулевым | `TractorView`, `PayPadView` (M9) |
| `new Mesh()` + `SetVertices` / `SetTriangles` (меш из кода) | `utils.MeshUtils.createMesh({ positions, normals, uvs, indices, minPos, maxPos, boundingRadius }, new Mesh())` → `MeshRenderer.mesh`. Обход треугольников — против часовой стрелки снаружи (проверено тестом по нормалям). `primitives.cone/cylinder` живут в модуле движка `primitive`: у нас он выключен, свою геометрию строим сами (`ArrowGeometry`) | стрелка туториала (M11) |
| `new Material(shader)` из кода | `material.initialize({ effectName: 'builtin-standard', defines: { … } })` + `setProperty('albedo', color)`. Эффект должен попасть в сборку: `builtin-standard` там есть, потому что им пользуются материалы трактора | `TutorialView` |
| GPU Instancing (галочка в материале) | Define `USE_INSTANCING: true` на материале: модели с одним мешем и одним материалом рисуются одним draw call. Нужен `ANGLE_instanced_arrays` (WebGL 1); без него движок рисует по одному — сцена не ломается (`--hide-ext ANGLE_instanced_arrays`) | две стрелки туториала: +1 draw call вместо +2 |

## Грабли ядра

- **URL asset-db чувствительны к регистру, файловая система Windows — нет.** Путь с другим регистром регистрирует папку второй раз и перевыдаёт UUID её файлам.
- MCP `refresh_assets` без пути обновляет `db://assets/` со слэшем и регистрирует фантомную папку. Обновлять только точные пути.
- Картинка для UI: после импорта поставить тип `sprite-frame` в мете (что делает Inspector) и переимпортировать.
- Headless Chrome/Edge рисует **текст** на canvas без сглаживания (фигуры — со сглаживанием). Инструменты, которые рисуют картинки canvas'ом, рисуют в 4× и уменьшают.
- `performance.now()` в браузере огрублён до ~0,1 мс: шаг шариков в 0,3 мс меряем гистограммой по тысячам шагов, а не отдельными замерами.
- Превью редактора рисует игру в своей рамке (канвас шире страницы): раскладку UI смотреть в собранном HTML.
- На `director.pause()` не срабатывают ни `EVENT_BEFORE_UPDATE`, ни `EVENT_AFTER_UPDATE` (а `getTotalFrames()` растёт: рендер идёт). Счётчик FPS по `EVENT_AFTER_UPDATE` во время пауз под скриншоты занижается (M12: 49 fps вместо 60) — начало окна замера сдвигаем на длину паузы.
- **Звук в Cocos на вебе (S1–S2).** `AudioSource` + `AudioClip` — как в Unity, но: (1) **браузер не даёт играть, пока нет настоящего жеста** пользователя (`touchend`/`mouseup`/`click`; `touchstart` не считается): `AudioContext` до него `suspended`. `play()` до жеста движок ставит в очередь и запускает на первом `touchend` канваса, но каждый такой вызов вешает два слушателя, а `playOneShot`, начатый до жеста, потом «выстреливает» разом — поэтому разовые звуки до разблокировки выбрасываем, а циклы просим запуститься и повторяем просьбу каждые 0,5 с. (2) Питча нет (нет `pitch`, как у Unity `AudioSource.pitch`): варианты клипов вместо него. (3) `playOneShot` — аналог `PlayOneShot`, но асинхронный; лимит голосов 24 в самом движке. (4) Клип ищется по имени ассета (`clip.name` = имя файла без расширения); клипы, на которые есть ссылка из сцены, едут в основном бандле — папка `resources` не нужна. (5) Декодированный MP3 длиннее исходника (задержка кодека ~50 мс в начале и ~20 в конце) — цикл получит щель, если не записать метку LAME/Info (`tools/audio/lib/mp3tag.mjs`); WAV точен всегда. (6) Проверять «играет ли звук» без ушей можно, повесив `AnalyserNode` на выход контекста (`tools/scenarios/lib/audio-tap.mjs`): пик сигнала — это число, а не обещание вызова.
