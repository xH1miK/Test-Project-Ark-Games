# CLAUDE.md

Playable-ad test task for Royal Ark Games: re-create the opening of their "Zombie Miner" example in **Cocos Creator 3.8.8** (3D, TypeScript).
Deliverable: ONE self-contained HTML file ≤ 5 MB (portrait + landscape, runs from file:// with zero network requests) + a report on the AI process with a timeline.

Talk to the user in **Russian**. Code, comments and commit messages in English. The user knows Unity well and is new to Cocos — explain Cocos specifics through Unity analogies (docs/UNITY_TO_COCOS.md).

## Read first
- `docs/PLAN.md` — schedule, decisions, status checklist (keep it updated)
- `docs/GDD.md` — our spec and starting numbers
- `docs/reference-example-teardown.md` — how the example works. Behaviour/number reference only: **never copy its code or shaders**
- `docs/tools-research.md` — MCP, packer, build settings, ad-network gotchas
- `docs/AI_LOG.md` — timestamped AI-process log. Append an entry at every milestone: what was delegated, how it was verified, what broke, how it was fixed, AI vs human
- `reference/` (gitignored, local only) — decoded example data: `scene_tree.txt`, `cond/*.js` (one line per property with tooltip), `pretty/*.js`

## Scope
Must: tractor + upgrade to tier 2 · balls scooped into the bucket and handed into the shredder (2 coins each) · arrow tutorial · basic sounds · gate opening = final point.
Plus: juice (coin flights, shredder rollers, upgrade swell, camera zoom-out, particles at the gate).
Out: intro flyover, packshot/CTA, second floor, gold balls, conveyor.

## Architecture
`assets/scripts/{core,input,camera,tractor,balls,world,economy,tutorial,audio,ui}`
- No physics module. Tractor, balls and pads use our own code (static XZ obstacle grid, custom ball sim).
- BallField is data-oriented (typed arrays, uniform grid, sleeping balls). BallRenderer draws all balls with one dynamic mesh = one draw call (impostor effect).
- All tunables in `core/Config.ts`. Systems talk through `core/Events.ts` where practical.
- Static level layout lives in the scene (built via MCP); dynamic objects are spawned by code.
- `core/GameRoot.ts` is the composition root: creates the models, injects them into views, runs the frame in a fixed order (input, then steps of ≤ `Config.time.maxStep`: tractor → balls → bucket → shredder; `lateUpdate`: camera, renderers). Level collision = `StaticBlocker` components under the `Level` node → `ObstacleGrid`.
- Drive (M2): `JoystickModel` → `MoveInput` (camera-relative, autopilot override) → `TractorModel` (body circle `bodyOffset` ahead of the pivot, substeps ≤ `maxStep`) → `TractorView`; `CameraRigModel` (`zoomTo` on `tierChanged`) → `CameraRigView`; `UiFit` on the Canvas keeps the 1280×2276 frame on screen.
- Balls (M3): `BallField` (3D position-based; XZ cell grid, a column per cell; only balls in hot cells are simulated; order of authority in a step: floor → pusher → field edges → rocks, so rocks always win) + `layCarpet` (seeded). The tractor is the `BallPusher`: per-tier `pusher` boxes in its axes, faces shared by body and bucket are `shut`. `moved` lists balls a view must redraw. Tests/bench share `tools/test/ball-world.mjs` (fixture arena, autopilot, `measure`: "outside" = outside the flood-filled arena, not the edge rectangle).
- Ball rendering (M4): `BallQuads` (pure; per ball 4 vertices in two streams: dynamic = centre + radius float32 and orientation as an int16 quaternion, static = quad corner + shade bytes; `writeMoved` rewrites only `BallField.moved` and rolls them: turn about up × way by way / radius) → `BallRenderer` on node `Balls` (Default layer, at the origin) owns a render-scene `Model` (not a MeshRenderer: the dynamic stream is a HOST|DEVICE buffer, uploaded once per frame only if something moved) → `assets/effects/BallImpostor.effect` (quad facing the eye, sphere ray-traced in the fragment shader, `gl_FragDepth` / `EXT_frag_depth` in WebGL 1). One sub-model, one pass = 1 draw call. The look lives in the effect's property defaults; `Materials/Balls.mtl` overrides nothing. GameRoot calls `ballView.render(balls)` in `lateUpdate` before `balls.clearMoved()`.
- **Screen UI is always on top** (user rule, 28.09): all of it lives under `Canvas`, drawn by the Canvas' UI camera — priority above every other camera, clears depth only, sees `UI_2D` only. Groups in draw order (a later sibling is drawn on top): `Canvas/Hud` (HUD, buttons, coin flights, tutorial texts, end screen) → `Canvas/Joystick` (last = topmost). New UI goes into a group, never straight under `Canvas`; no 3D node on `UI_2D`, no camera after the UI camera; world-space UI (pad labels) is on `UI_3D`/Default for the main camera. The `drive` scenario checks all of it (`tools/scenarios/lib/ui-layers.mjs`).
- QA hooks: with `?qa` in the URL the models are published on `window.__zm` (`core/QaBridge.ts`) for scenario scripts.

## Code style (the user asked for MVP, OOP, SOLID)
- **Model** = plain TypeScript without `cc` imports: game state and rules, unit-tested in Node. **View** = Cocos component that only renders/applies state. **Presenter/controller** = wires a model to its views.
- One responsibility per class; dependencies passed in by the composition root, no hidden singletons (Config and the event bus type are the shared vocabulary).
- Pure modules use erasable TS only (Node type stripping): no `enum`, `namespace`, parameter properties; `import type` for types; extensionless relative imports.
- Checks: `node tools/typecheck.mjs` (strict tsc bundled with Cocos) and `node --import ./tools/test/register.mjs --test "tools/test/*.test.mjs"`.

## Cocos 3.8.8 conventions
- `import { _decorator, Component, Node, Vec3 } from 'cc'; const { ccclass, property } = _decorator;` with a project-unique `@ccclass('Name')`.
- Lifecycle: onLoad → onEnable → start → update(dt) → lateUpdate(dt) → onDisable → onDestroy.
- Right-handed, Y-up, cameras look down −Z. Position/rotation getters return readonly refs — use setPosition / setWorldPosition / setRotationFromEuler.
- No allocations in per-frame code: reuse module-level temp Vec3/Quat, prefer `Vec3.add(out, a, b)` statics.
- Motion via `tween()`, timers via `scheduleOnce`. AudioSource has no pitch → use clip variants.
- Runtime-loaded assets must live under `assets/resources`.

## Editor & MCP rules
- MCP server `cocos` = Funplay Cocos MCP v0.6.4 (`extensions/funplay-cocos-mcp`, gitignored; install steps in `docs/SETUP.md`), `http://127.0.0.1:25720/`, `full` tool profile (`funplay-cocos-mcp.config.json`). It runs inside the editor: if its tools fail, ask the user to open the project in Cocos Creator 3.8.8. Health check: `GET http://127.0.0.1:25720/health`. If the session started before the editor, its `cocos` tools stay unloaded until the user reconnects in `/mcp` — meanwhile call them with `node tools/mcp.mjs <tool> '<json>'` / `node tools/mcp.mjs js <scene|editor> @file.js`.
- Change `.scene` / `.prefab` ONLY through the Cocos MCP or the editor. Never hand-edit scene/prefab JSON; never edit or copy `.meta` UUIDs.
- **asset-db URLs are case-sensitive, the Windows file system is not.** Use the exact case of existing folders (`db://assets/Materials/...`, capital M — made by the FBX import). A wrong-case URL makes asset-db register the folder twice and re-UUID its files (happened 27.09; fixed by restoring the metas from git and a clean re-import).
- New assets from code: create in the scene process and serialize with `EditorExtends.serialize`, then `asset-db create-asset`/`save-asset`. For materials strip pipeline macros (`CC_*`) from `_defines` — the serializer bakes the editor's pipeline state into them.
- **Never call the MCP `refresh_assets` without a path**: it refreshes `db://assets/` (trailing slash) and asset-db registers a phantom folder for the assets root (`assets/.meta`, happened 27.09). Refresh exact files: `Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/scripts/x.ts')`. Never `delete-asset`/`move-asset` a folder whose source is the assets root.
- Linked prefab instance: `scene:create-node` with `{ parent, assetUuid, type: 'cc.Prefab', unlinkPrefab: false }` (without `type` it comes out unlinked). Change instance children through `scene:set-property` — that records a prefab override; a raw scene-script change does not. The MCP tool `inspect_prefab_instance` can return megabytes — check `node._prefab.instance` in a scene script instead.
- UI built from a scene script: set Widget margins last and through `scene:set-property` (`__comps__.<i>.top` …). Resizing a Widget node in the editor makes its "stay put" logic rewrite the margins (a stretched node got −1088/−590 on 27.09). UI nodes need `layer = UI_2D`; start a Canvas from the editor preset `db://internal/default_prefab/ui/Canvas.prefab` (`unlinkPrefab: true`) to get its UI camera.
- `git commit` before any batch of scene operations; save the scene through MCP afterwards.
- A new `.ts` file must be compiled by the editor before its component can be added — wait for the asset refresh.
- After each feature: run the preview in the browser, check the console, drive the tractor with a scripted autopilot (override the joystick output via JS) through the scenario, take screenshots.

## Build
- `node tools/build.mjs` — web-mobile build inside the open editor (builder `add-task` via MCP) from `build-config/web-mobile.json`: Debug / source maps / MD5 off, Merge All JSON, mangle + inline enums. CLI build only with the editor closed (EPERM otherwise).
- Feature Cropping (`settings/v2/packages/engine.json`; change through `Editor.Profile`, not by hand while the editor is open): base, gfx-webgl, 3d, 2d, ui, audio, tween, legacy-pipeline. Add a module only when code needs it, then re-measure.
- `node tools/pack/pack.mjs` → `dist/ZombieMiner.html` + size report (hard limit 5,000,000 bytes, target ≤ 4.8 MB; empty scene = 0.56 MB).
- `node tools/check-html.mjs dist/ZombieMiner.html` — headless Edge from `file://`, portrait + landscape: zero external requests, no console errors, scene running; screenshots in `dist/shots/`. `--scenario <name>` runs `tools/scenarios/<name>.mjs` (adds `?qa`); an http target (`http://localhost:7456/`, the editor preview) is quicker while iterating; `--gpu` uses the real GPU for FPS numbers (default SwiftShader is software GL: deterministic, but slow on big PBR surfaces). Pages run as touch phones (DPR 2, touch emulation); scenarios get `t.touch(type, x, y)` for real touches. The editor preview wraps the game in its own frame (toolbar, 2560×1590 "window"), so judge UI layout on the packed HTML. Note: classes like `MeshRenderer` are not on the runtime `cc` namespace — use `cc.js.getClassByName('cc.MeshRenderer')` in page scripts.
- Scenarios: `level` (collision map, arena closed; ball flood fill at 0.1 — coarser sampling missed a crack), `drive` (autopilot route + rams with a per-frame penetration probe ≤ 0.05, camera and tier zoom, UI layering, real-touch joystick), `balls` (T1/T2 through the carpet, audit of rocks/arena/NaN, sleep after stops, step time; M4: +1 draw call exactly, drawn-vs-field sync every 4th frame, no uploads while asleep, rolling, joystick over the real balls by screenshot pixels (`lib/png.mjs`), FPS with/without balls, close-ups incl. a synthetic depth shot; `ZM_BALL_OVERLAY=1` paints debug circles, orange = simulated). The autopilot (`tools/scenarios/lib/autopilot.mjs`) hooks `cc.Director.EVENT_BEFORE_UPDATE` and drives `__zm.input.override(x, z)`; `__zm.config` is the game Config. `t.evaluate`/`t.waitFor` return values by value: wrap expressions that yield engine objects in `!!(…)` (a component never serialises, so `waitFor` would time out). `--webgl1` hides WebGL 2 from the page (old-phone fallback).
- `node --import ./tools/test/register.mjs tools/bench/balls.mjs [--fps 60] [--tier 1|2]` — ball sim benchmark on the fixture arena (ms per frame, sleeping share, overlaps).
- The Cocos splash is off through the builder option `useSplashScreen: false` (the user unchecked Enable Splash on 27.09). Never patch it out of the build output.

## Art
- `node tools/art/prepare.mjs [name] [--preview <dir>]` — resize/compress `art-src/` (GPT-image) into `assets/` with sharp (`cd tools/art && npm install` once). Specs live in the script.

## Git
Small focused commits. Private GitHub repo (xH1miK). Never commit build/, library/, temp/, local/, profiles/, reference/.
- One branch per milestone/task from `main`: `<stage>/m<N>-<name>` (e.g. `core/m2-drive`).
- Merge into `main` only after the milestone is verified: `node tools/merge.mjs` — a `--no-ff` merge commit made without touching the working tree (the editor keeps the project open), then HEAD is on `main`; start the next branch with `git switch -c`.
- Roll back a milestone with `git revert -m 1 <merge>`; never reset `main` without the user's OK.
- Push (main and branches) only when the user asks.
