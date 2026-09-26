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
