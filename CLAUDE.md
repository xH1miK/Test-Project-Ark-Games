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
- `core/GameRoot.ts` is the composition root: creates the models, injects them into views, runs the frame in a fixed order (input → tractor → balls → bucket → shredder; `lateUpdate`: camera, renderers). Level collision = `StaticBlocker` components under the `Level` node → `ObstacleGrid`.
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
- `git commit` before any batch of scene operations; save the scene through MCP afterwards.
- A new `.ts` file must be compiled by the editor before its component can be added — wait for the asset refresh.
- After each feature: run the preview in the browser, check the console, drive the tractor with a scripted autopilot (override the joystick output via JS) through the scenario, take screenshots.

## Build
- `node tools/build.mjs` — web-mobile build inside the open editor (builder `add-task` via MCP) from `build-config/web-mobile.json`: Debug / source maps / MD5 off, Merge All JSON, mangle + inline enums. CLI build only with the editor closed (EPERM otherwise).
- Feature Cropping (`settings/v2/packages/engine.json`; change through `Editor.Profile`, not by hand while the editor is open): base, gfx-webgl, 3d, 2d, ui, audio, tween, legacy-pipeline. Add a module only when code needs it, then re-measure.
- `node tools/pack/pack.mjs` → `dist/ZombieMiner.html` + size report (hard limit 5,000,000 bytes, target ≤ 4.8 MB; empty scene = 0.56 MB).
- `node tools/check-html.mjs dist/ZombieMiner.html` — headless Edge from `file://`, portrait + landscape: zero external requests, no console errors, scene running; screenshots in `dist/shots/`.
- The Cocos splash is off through the builder option `useSplashScreen: false` (the user unchecked Enable Splash on 27.09). Never patch it out of the build output.

## Art
- `node tools/art/prepare.mjs [name] [--preview <dir>]` — resize/compress `art-src/` (GPT-image) into `assets/` with sharp (`cd tools/art && npm install` once). Specs live in the script.

## Git
Small focused commits. Private GitHub repo (xH1miK). Never commit build/, library/, temp/, local/, profiles/, reference/.
- One branch per milestone/task from `main`: `<stage>/m<N>-<name>` (e.g. `core/m2-drive`).
- Merge into `main` only after the milestone is verified: `node tools/merge.mjs` — a `--no-ff` merge commit made without touching the working tree (the editor keeps the project open), then HEAD is on `main`; start the next branch with `git switch -c`.
- Roll back a milestone with `git revert -m 1 <merge>`; never reset `main` without the user's OK.
- Push (main and branches) only when the user asks.
