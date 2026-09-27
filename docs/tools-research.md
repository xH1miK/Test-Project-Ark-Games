# Tools research (2026-09-26)

## MCP for Cocos Creator 3.8.8 → Claude Code

- **Primary: FunplayAI/funplay-cocos-mcp** — MIT, v0.6.4 (2026-09-19, fixes Claude Code config on Windows), Cocos Store says Creator ≥ 3.8.8.
  Streamable HTTP at `http://127.0.0.1:<port>/` (port derived per project, 20000–29999). No npm build needed.
  - Install: `git clone https://github.com/FunplayAI/funplay-cocos-mcp.git extensions/funplay-cocos-mcp` (or unzip release v0.6.4 there), restart editor.
  - Editor: **Funplay → MCP Server** (auto-starts, shows port). Health: `GET /health`, `GET /tools`.
  - Register (claude CLI not on PATH here → use project `.mcp.json`): `{"mcpServers":{"cocos":{"type":"http","url":"http://127.0.0.1:<port>/"}}}`. New Claude Code session needed to load it.
  - Profiles: core (39 tools) / full (105: create_node, add_component, set_component_property, save_current_scene, instantiate_prefab, simulated input, execute_javascript, screenshots, logs). Build tools only open the panel.
- **Fallback: harady/cocos-creator-mcp** — MIT, tested on 3.8.8, HTTP `:3000/mcp` or stdio bridge; needs `npm install && npm run build`.
- Avoid DaxianLee/cocos-mcp-server free edition (license forbids commercial use; open scene-saving issues).
- No official MCP in 3.8.8; `cocos-cli start-mcp-server` is alpha, targets Cocos 4 / PinK.
- **No MCP reliably runs a build** → build via Build panel or CLI.

## Single-file HTML packing

- **Try first: ppgee/cocos-pnp** (MIT, `playable-3x.zip`, `.adapterrc` at project root: `{"buildPlatform":"web-mobile","orientation":"portrait","exportChannels":["AppLovin","Unity"],"isZip":true}`). Last push 2024-06; open issues about black screens on 3.8.1/3.8.2 and MD5 cache → smoke-test on day 1.
- Alternatives: Playbox `plbx-cocos-assistant` (Apache-2.0, 3.8.0+, young; review telemetry), super-html (paid ¥128).
- **Fallback: our own Node packer** modelled on the example's loader (virtual FS + fetch/XHR/src hooks + gzip + inflate fallback + MRAID ready).

## Build settings for size

- Feature Cropping: untick 2D/3D physics, particles 2D, Spine, DragonBones, TiledMap, video, WebView, terrain, XR, light probes, geometry renderer; tick "remove deprecated interfaces".
- Build panel (web-mobile): Debug off, Source Maps off, **MD5 Cache off**, Main Bundle Compression = **Merge All JSON**, Main Bundle Is Remote off, Mangle Engine Internal Properties + Inline Enums on; no wasm modules if possible.
- Textures: one format each (WebP). Audio: pre-encode MP3 ourselves (mono, low bitrate). Splash off.
- Networks measure raw HTML size; base64 adds ~33% to binaries; target ≤ 4.8 MB.

## Ad-network gotchas

- Must run from `file://` with zero network requests.
- Audio only after first user gesture; stop when hidden (AppLovin).
- MRAID: wait for `ready`; CTA via `mraid.open(url)`, `window.open` only as local fallback.
- AppLovin: single HTML ≤ 5 MB, both orientations, test at https://p.applov.in/playablePreview?create=1. Unity: < 5 MB, MRAID 3.0. ironSource: 4 MB.

## CLI build (3.8.8, Windows)

`"C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe" --project "<proj>" --build "configPath=<proj>\build-config\web-mobile.json"`
Exit code 36 = success, 32 = bad params, 34 = build error. Config JSON from Build panel **Export**. Fails with EPERM if the editor has the same project open.

## Findings from the smoke test (2026-09-27)

- **Build inside the open editor**: the builder (1.3.9) accepts `Editor.Message.request('builder', 'add-task', options)` — the same call the Build panel makes; `query-tasks-info` gives state/progress. Wrapped in `tools/build.mjs` (via Funplay `execute_javascript`, context `editor`). Options schema: `app.asar.unpacked/builtin/builder/@types/public/options.d.ts` in the Creator install. Missing options are filled with defaults (see `temp/builder/log/*.log`). "Workers failed to exit gracefully / SIGTERM" in the log is benign.
- Do NOT call `command-build` in a running editor (CLI entry point; may quit the app).
- **Feature Cropping** lives in `Editor.Profile` project `engine` → `modules.configs.defaultConfig.{cache, includeModules, flags, noDeprecatedFeatures}` + `modules.graphics.pipeline`. `includeModules` holds feature names from `resources/3d/engine/cc.config.json`. Engine compile ~3.5 min, cached per option md5 in `%TEMP%/CocosCreator/3.8.8/builder/engine/`.
- A disabled skybox still packs its cubemaps if the scene references them — clear `_envmap*` references.
- **Splash**: build option `useSplashScreen` (Build panel → task ✎ "Edit Build Project Config" → "Enable Splash"). With it off the builder writes `splashScreen.totalTime = 0` and no logo (−19.6 KB, −2 s start). The i18n mentions an account form for failed removals; in our case unchecking was enough (`information.json` flags stayed `complete:false`).
- `remove-task(id)` removes a Build-panel task entry only; the build folder stays.
- Funplay One-Click Configure writes a duplicate **user-scope** MCP server into `~/.claude.json` (`cocos-<project>-<hash>`) and installs skills into `.claude/skills`.
- Funplay `execute_javascript` safety checks reject string literals that look like absolute paths — including `'\n'` and `/` regexes; use `String.fromCharCode(10)` and `startsWith`. Scene context predeclares `cc, Editor, scene, director, args, console`; editor context predeclares `fs`, `path`.

### cocos-pnp code review (not adopted)
- Packs every file into one JSON map (binaries as base64 inside it) → deflate (pako) → base64 → HTML + 47 KB pako.
- Loader: SystemJS `createScript` → blob URL, `fetch` override, and `cc.assetManager.downloader.register` for known extensions; `.mp3` etc. not registered → audio goes to the engine's XHR path, which it does not hook.
- `enableSplash:false` zeroes `splashScreen.totalTime` in the packed `settings.json` — bypasses the editor's licence gate.
- Optional TinyPNG upload (network, off by default). Last commit 2024-06.

## Project location

Project names: `a-zA-Z0-9_-` only; build path must have no spaces / non-ASCII. EPERM file-lock issues in `temp/`, `library/` are common on Windows → keep the project **outside OneDrive** at an ASCII path, e.g. `C:\dev\...`. Back up with git/GitHub instead.

## Hand-editing Cocos files

Edit `.ts` freely. Change `.scene`/`.prefab` only via MCP/editor (format undocumented, easy to corrupt). Never touch `.meta` UUIDs. Commit before any risky scene operation.
