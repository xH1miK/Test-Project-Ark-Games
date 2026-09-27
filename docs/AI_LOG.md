# AI process log

Running log of how AI was used: what was delegated, how results were verified, what broke and how it was fixed.
Times are local (Europe/London). AI = Claude Code (Opus 5.5, desktop app) unless noted.

## 2026-09-26 (Sat) — Analysis & planning (~22:48–23:30)

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 22:48 | Read the brief PDF; inspected the example HTML: Cocos 3.x build packed into one file by a custom loader | AI | — |
| 22:52 | Wrote a Node script to unpack the embedded file table (159 files: gzip JSON/JS, WebP images, MP3) and split the game bundle into 80+ modules by original class name | AI | File list and sizes printed; module names match original `.ts` files |
| 22:55 | Launched 2 parallel sub-agents: (1) reverse-engineer the example's game design from code + decoded scene, (2) research Cocos MCP servers, single-HTML packers, build settings | AI | Both returned sourced reports (~26 min each) |
| 22:55 | Served the example locally, opened it in Claude's built-in browser, dumped all custom component values from the live scene via JS | AI | Got exact numbers: upgrade 100, gate 300, 2 coins/ball, 2250-ball field, camera/joystick/pad params |
| 23:00 | Wrote a JS "autopilot" that overrides the joystick output and drove the tractor through the whole scenario (collect → shred → upgrade → gate) with screenshots | AI | Observed tutorial steps, pad reveal, tier-2 swap, gate unlock. Issue: tractor orbited targets (arrival radius too small for tier 2) → widened stop radius |
| 23:05 | Browsed the asset pack on Google Drive (preview only): Tractor1/2.glb, SM_Shred, SM_Gate, FarDoor, 4 rocks; no balls/ground/UI/audio | AI | — |
| 23:10 | Asked the user 4 scoping questions | AI → human | Answers: Unity background; style = example + own polish; extras = juice; generative tools = ChatGPT/GPT-image |
| 23:20 | Merged findings: MCP = Funplay (fallback harady); packer = cocos-pnp smoke test, fallback own packer modelled on the example's loader; move project out of OneDrive/Cyrillic path | AI | Research flagged Cocos path restrictions + EPERM locks on Windows |
| 23:25 | Wrote plan, architecture, day-by-day schedule, risks | AI | Presented to the user |
| 23:30 | User decisions: move project to `C:\dev\Test-Project-Ark-Games`, private GitHub repo | human | — |
| 23:35 | Prepared project docs for the new repo: PLAN, GDD, UNITY_TO_COCOS, ART_PROMPTS, CLAUDE.md, teardown + tools research; created `C:\dev` | AI | Docs carry the context into a fresh Claude Code session (needed to load the MCP) |

Decision: the example is used as a behaviour/numbers reference only — no code or shader is copied.

## 2026-09-26 (Sat) — Environment setup (~23:30–00:00)

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 23:30 | Installed Cocos Creator 3.8.8 via Dashboard, created the Empty (3D) project at `C:\dev\Test-Project-Ark-Games`, downloaded and unpacked `3d_Assets.zip` | human | `package.json` shows creator 3.8.8 |
| 23:45 | Generated 10 UI/texture images in ChatGPT (GPT-image) from AI-written prompts (`docs/ART_PROMPTS.md`); ChatGPT also wrote `art-src/PROMPTS_USED.md` | human + GPT-image | AI reviewed them in a browser gallery on a checkerboard: transparent backgrounds OK, icons readable at 60 px |
| 23:50 | Copied `ZM_3DPack` into `assets/` with its `.meta` files (per the pack README), art sources into `art-src/`, docs + `CLAUDE.md` into the repo, decoded example data into gitignored `reference/` | AI | — |
| 23:52 | Installed Funplay Cocos MCP v0.6.4 (pinned tag) into `extensions/`. **Reviewed its code before enabling**: network = GitHub release check only (no auto-install); client configs are written only from a panel button. Computed its per-project port (25720) from its source, pinned it + `full` tool profile in `funplay-cocos-mcp.config.json`, registered server `cocos` in `.mcp.json` | AI | `claude` CLI isn't on PATH, so `.mcp.json` instead of `claude mcp add` |
| 23:56 | Added `docs/SETUP.md` (reproducible setup), `tools/serve.mjs` + `.claude/launch.json` (preview example / builds), migrated Claude memory to the new project path | AI | — |

## 2026-09-27 (Sun) — MCP check & packaging smoke test (~12:58–13:40)

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 12:58 | Health check `GET :25720/health` failed: editor not running; the session had started with both MCP entries failed | AI → human | Asked the user to open the project; they did |
| 13:01 | MCP up (Funplay 0.6.4, 105 tools, `full`). Its tools could not be hot-loaded into the running AI session (only the user can reconnect via `/mcp`), so wrote `tools/mcp.mjs` — a 50-line stateless JSON-RPC client — and drove the MCP through it | AI | `get_editor_state` → project path, Cocos 3.8.8, port 25720 |
| 13:02 | Found that the Funplay panel's One-Click Configure had added a duplicate user-scope server `cocos-test-project-1cb0e7` to `~/.claude.json` and installed its skills into `.claude/skills` | AI | Flagged to the user (duplicate would double the tool list); skills committed |
| 13:03 | Committed editor-generated metas (first import re-pointed FBX texture paths, dumped the gate's FBX material) | AI | `git diff` reviewed: path fixes + new material UUID only |
| 13:04 | `create_scene` → `assets/scenes/Main.scene` (camera + light). Disabled the skybox and **cleared its cubemap references**, otherwise disabled-but-referenced cubemaps still get packed | AI | Saved scene has zero `__uuid__` references |
| 13:05 | Feature Cropping through `Editor.Profile.setProject('engine', …)` — read the real 3.8.8 module schema from the editor first. Kept: base, gfx-webgl, 3d, 2d, ui, audio, tween, legacy-pipeline; deprecated APIs removed | AI | `settings/v2/packages/engine.json` rewritten by the editor; build output `includeModules` matches |
| 13:08 | **Build without closing the editor**: listed the builder's IPC messages, found internal `add-task` (what the Build panel calls) → `tools/build.mjs` + `build-config/web-mobile.json` | AI | Task queued and built: success in 3 min 53 s (first engine compile) |
| 13:13 | Splash: the build still embeds the Cocos splash (2 s + 19.6 KB logo). In 3.8.8 removing it needs the account form *Project → Build → Edit Build Project Config*; the builder refuses otherwise | AI → human | Read from the builder's own messages. Not bypassed; left for the user |
| 13:14 | cocos-pnp: cloned and **reviewed the source**. Concerns: `enableSplash:false` patches the splash out of `settings.json` (bypasses the licence gate above), audio not routed through its loader, pako (+47 KB), base64 inside deflated JSON, unmaintained since 2024-06. Running its prebuilt 561 KB minified bundle was **blocked by the AI permission classifier** (unreviewed third-party code) | AI | Decision: plan's fallback — own packer |
| 13:16 | Own packer `tools/pack/`: text files → one gzip stream → base64; media → raw base64; loader maps every URL the engine requests (XHR, fetch, script/img/media `src`) to `blob:` URLs of embedded files — engine-agnostic, no Cocos internals patched. Fallback inflate for browsers without `DecompressionStream` written from RFC 1951 | AI | `test-inflate.mjs`: 22 inputs × 9 zlib settings (incl. every build file) byte-identical, 0 failures |
| 13:23 | Packed empty scene: **579,494 bytes** single HTML | AI | Size report per group (below) |
| 13:24 | Browser test in the built-in pane over http: engine 3.8.8 boots, scene `Main` loads, only `blob:` requests. Pane can't open `file://` and pauses `requestAnimationFrame` while hidden → not reliable for timing | AI | Console clean |
| 13:26 | `tools/check-html.mjs`: headless Edge over the DevTools protocol, opens the HTML **from `file://`**, portrait 390×844 + landscape 844×390, asserts zero external requests, no console errors, scene running, saves screenshots | AI | PASS both orientations, 60 fps, 13 requests all `blob:`/self; forced JS-inflate path PASS too (inflate 58 ms vs 25 ms native) |
| 13:28 | Committed; started engine-variant builds in background (custom pipeline; + particle + animation) to price optional modules | AI | See table below |

Empty-scene single HTML (lean engine, legacy pipeline, splash still on):

| Part | Raw | In HTML (gzip + base64) |
|---|---|---|
| Engine `cocos-js/cc.js` | 1,275.5 KB | ≈ 468.5 KB |
| Internal bundle (builtin effects) | 225.0 KB | ≈ 43.7 KB |
| Boot (polyfills, SystemJS, index/application) | 24.2 KB | ≈ 11.0 KB |
| `settings.json` (19.6 KB is the splash logo) | 20.7 KB | ≈ 20.7 KB |
| Main bundle + game scripts | 4.5 KB | ≈ 2.9 KB |
| Shell (HTML, CSS, loader, inflate) | — | 17.0 KB |
| **Total** | 1.55 MB | **0.579 MB** → 4.42 MB headroom under 5 MB |

Engine variants (13:28–13:38, built and packed by a script through the same MCP path; each HTML checked from `file://`):

| Variant | `cc.js` raw | `cc.js` gzip | Single HTML | vs lean | Build |
|---|---|---|---|---|---|
| **lean, legacy pipeline** (chosen) | 1,306,116 | 359,497 | **579,494** | — | 3 min 53 s cold / 1 min 33 s cached |
| custom pipeline (3.8.8 default) | 1,399,680 | 379,844 | 628,485 | +49 KB | 3 min 50 s |
| legacy + particle + animation | 1,504,577 | 410,291 | 671,594 | +92 KB | 4 min 20 s |

Decisions: keep the legacy pipeline (−49 KB, both render). The 3D ParticleSystem + animation cost +92 KB — affordable, decided at the juice stage (own pooled FX vs ParticleSystem). The final lean rebuild was **byte-identical** to the first one → builds are deterministic and the settings were restored exactly.

## 2026-09-27 (Sun) — Splash off, MCP cleanup (~13:42–13:55)

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 13:42 | User asked for plainer instructions → AI opened the Build panel via MCP, screenshotted it and read the panel templates to name the exact buttons (task card ✎ = "Edit Build Project Config", option "Enable Splash") | AI | Instructions matched the real UI |
| 13:47 | Unchecked **Enable Splash** in the Build panel; reconnected `cocos` in `/mcp` (native MCP tools now in the session) | human | `mcp__cocos__execute_javascript` works |
| 13:49 | Removed the duplicate `cocos-test-project-1cb0e7` from `~/.claude.json` (user's go-ahead; backup `~/.claude.json.bak-2026-09-27`) | AI | Diff vs backup = only that key; re-checked later that the app hadn't re-added it |
| 13:50 | Build with `useSplashScreen: false`: the builder itself writes `splashScreen.totalTime = 0` and drops the logo (`settings.json` 21 KB → 1.7 KB). The editor's form flags in `information.json` stayed `complete:false` — unchecking was enough; the "form required" reading of the i18n strings was over-cautious | AI | Single HTML **556,893 bytes**; `check-html` PASS portrait + landscape; engine+scene start 1.0–1.6 s (was 1.9–3.4 s with the splash) |
| 13:52 | Scripted builds had left 5 identical tasks in the Build panel → `remove-task(id)` removes only the list entry (build files stay); `tools/build.mjs` now drops older tasks after a successful build | AI | Panel shows one task; rebuild byte-identical |
| 13:56 | Pushed the stage to GitHub (6 commits, 37 text files; reviewed the list first: no build output, no secrets) | AI (on user's request) | `main` = `origin/main` |
| 13:58 | Wrote the handoff prompt for the next session (stage "Core") → `docs/HANDOFF.md`; the user continues in a new chat opened after the editor, so MCP connects at start | AI → human | — |

## 2026-09-27 (Sun) — Stage "Core", M1: scaffolding and level (~14:03–16:30)

New session from the handoff prompt. Working rules added by the user: a git branch per milestone, merge to `main` only after verification; code by MVP/OOP/SOLID; tell when to move to a new chat.

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 14:03 | Read PLAN/GDD/teardown/log; MCP up (`get_editor_state`); proposed 7 milestones with done-criteria and checks | AI | — |
| 15:55 | Plan approved; branch `core/m1-level`. `tools/merge.mjs`: `--no-ff` merge into main via `merge-tree`/`commit-tree`/`update-ref`, so the open editor never sees files flip back to main | human → AI | `--dry-run` on the branch |
| 15:58 | Measured the asset-pack models in the scene process (bounds, pivots): rocks ≈1×0.4×0.5, gate ≈1×0.8×1 (scale ×8.5), tractor GLB child offset (6.97, −0.05, 21.4) to zero later | AI | — |
| 16:00 | Pure-TS models: `Config`, typed `EventBus`, `ObstacleGrid` (circles + oriented boxes in a CSR grid, Cocos Y-rotation convention); components `StaticBlocker` (box/circle/mesh-fitted), `GameRoot` (composition root), `QaBridge` (`?qa` → `window.__zm`) | AI | Node 24 runs the `.ts` directly: 12 unit tests (1 wrong expectation in my own test, code was right) |
| 16:02 | Strict type check with the tsc bundled in Cocos: MCP diagnostics showed 88 errors, all inside engine `.d.ts` → `skipLibCheck` + `strict` in `tsconfig.json`, `tools/typecheck.mjs` | AI | `--listFiles` confirms our 6 files are checked; 0 errors |
| 16:04 | Ground texture from GPT-image: sharp in Cocos' install can't load outside Electron (deps inside `app.asar`) → pinned sharp in `tools/art`, `prepare.mjs` (1254 px PNG → 512 JPEG, 21 KB) | AI | 2×2 tiling preview: seamless |
| 16:05 | Ground material created in the scene process (`EditorExtends.serialize` → `asset-db`). **Bug:** the serializer baked the editor pipeline macros (`CC_USE_HDR`, fog, shadows…) into `_defines` → stripped `CC_*` | AI | Compared with an editor-made material from the pack (`_defines: [{}]`) |
| 16:07 | **Incident:** the material URL `db://assets/materials` (lower case) vs existing `assets/Materials` (FBX import). Windows paths are case-insensitive, asset-db URLs are not → the folder got registered twice and its files re-UUIDed; the gate FBX lost its dumped-material reference | AI | Found by `git status` (3 metas with new UUIDs) + asset-db query (two trees) |
| 16:10 | Fix: user closed the editor; restoring metas + deleting `library/` in one command was **blocked by the permission classifier** (irreversible) → switched to a reversible variant: metas from git, `library/` moved to a backup folder; user reopened the project | human + AI | Re-import: one `Materials` tree, original UUIDs, no meta changed. Rule added to CLAUDE.md |
| 16:21 | Level via MCP in one scene script: ground (plane ×12, unlit tiled), 38 rocks in 4 walls (tall far walls, low near walls, seeded jitter), gate house, spots; shredder as a **linked prefab instance** under a transform node (`scene:create-node`); 40 StaticBlockers; `Game` + GameRoot; iso camera | AI | Read back the saved `.scene`: 40 blockers, 1 prefab instance, GameRoot → Level |
| 16:23 | `check-html` extended: http targets (editor preview) and `--scenario`; `tools/scenarios/level.mjs` — flood fill from the start for tractor (r 1.2) and balls (r 0.275), reachability of pads and shredder zone, ASCII collision map, overview shot | AI | First run: preview scene has no name → loader probe fixed; then PASS |
| 16:26 | Build (34 s) → pack → check from `file://` | AI | **PASS** portrait + landscape, 0 external requests. HTML **1.568 MB** (+1.0 MB: gate/shredder/rock meshes ≈0.7 MB raw, 2 PBR shader sources, gate JPEG). SwiftShader ≈15 fps (software GL) |
| 16:30 | M1 merged into `main` with `tools/merge.mjs` (first use: no file on disk changed) | AI | `git log --graph`: one merge commit |

### Level look pass (~16:32–16:50), branch `core/m1-level-look`

User review of the screenshots: rocks look small next to the gate house, a visible hole in a corner, floor stones too big, the flat plain outside the arena looks empty — "play with the proportions".

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 16:33 | Asked whether to switch chats first; AI suggested finishing the level here (its building context was loaded) | human + AI | — |
| 16:34 | `StaticMeshBatcher`: merges every rock into one mesh at startup (`BatchingUtility.batchStaticModel`); collision is built from the source meshes before | AI | Class compiled; typecheck OK |
| 16:35 | Floor: arena plane with ~1.3-unit stones; `GroundOuter` darker plane outside, seam hidden under the rocks | AI | Materials created with exact-case URL, no lowercase tree |
| 16:36 | Walls rebuilt: inner row 30 rocks (×1.6, collision, inner faces on the arena line), corner boulders, outer row without collision — tall on the far sides, lower on the near sides (camera-ray check: never above the line of sight to the tractor at the wall) | AI | `level` scenario: arena closed, spots reachable. Two more passes closed dark gaps between the rows (outer row closer and denser) |
| 16:40 | Scenario bug: `cc.MeshRenderer` is undefined on the runtime `cc` namespace (exists in the editor) → `cc.js.getClassByName` | AI | Check fixed: 69 rocks → 1 batched renderer, 4–7 draw calls per frame |
| 16:44 | Build → pack → check from `file://`; `check-html --gpu` added (real GPU instead of SwiftShader) | AI | PASS both orientations; **1.574 MB**; SwiftShader 4 fps (software fill of big PBR rocks), **GPU 60 fps**, start 1.4–1.8 s |

## 2026-09-27 (Sun) — Stage "Core", M2: drive (~16:55–17:50), branch `core/m2-drive`

New session from the handoff prompt (`docs/HANDOFF.md`); MCP connected at start.

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 16:55 | Read PLAN/GDD/log; MCP up. Measured Tractor1.glb in the scene process: inner node at (6.97, −0.05, 21.43), scale 1.357; zeroed, the model spans x ±0.85, z −0.77..1.88 around the pivot, bucket toward +Z | AI | Matches the teardown's bucket boxes |
| 17:00 | Pure-TS models: `JoystickModel` (floating stick, rescaled dead zone, edge margin, glide back), `MoveInput` (stick → world XZ relative to the camera yaw; `override`/`release` for an autopilot), `TractorModel` (accel/brake, tank-like slowdown in turns, substeps ≤ 1/30 s, circle vs `ObstacleGrid` behind an interface), `CameraRigModel` (critically damped follow, `zoomTo` smoothstep), `fitFrame`. Views: `JoystickView`, `TractorView`, `CameraRigView`, `UiFit`; GameRoot runs input → tractor in `update`, views and camera in `lateUpdate` | AI | 44 Node tests green on the first run; strict typecheck |
| 17:07 | GPT-image joystick sprites: `prepare.mjs` got a circle crop (square centred on the solid shape, glow and shadow kept) → 320/160 px palette PNG, 31 + 8 KB; import type set to sprite-frame through asset-db (what the Inspector does) | AI | Preview sheet over light and dark backgrounds |
| 17:07 | **MCP bug:** `refresh_assets` without a path refreshes `db://assets/` with a trailing slash → asset-db registered a phantom folder for the assets root (`assets/.meta`, key "" in the library cache). No existing meta changed. It can't be removed from inside the editor: its source is the assets root, so `delete-asset` would delete everything | AI | `git status` (one new untracked file), asset-db query. Cleanup = one editor restart with a clean `library/`; rule added to CLAUDE.md |
| 17:10 | Scene through MCP: Canvas from the editor's built-in preset (UI camera, layers) + `UiFit`; `Joystick` (full-screen touch area, Widget) › Base › Knob; `CameraRigView` on Main Camera; `Tractor` with a linked Tractor1.glb instance whose inner offset was zeroed through `scene:set-property` → stored as a prefab override; design resolution 1280×2276 via `Editor.Profile` | AI | Saved scene read back: +7 nodes, none removed, GameRoot references set, `_lpos` override on the inner node |
| 17:11 | The first prefab instance came out **unlinked**: `scene:create-node` needs `type: 'cc.Prefab'` (found by reading the MCP tool's source); recreated | AI | Linked: `_prefab.instance` present |
| 17:15 | Preview: no joystick. The editor's Widget "stay put" logic had turned my `setContentSize` into margins −1088/−590 → touch area 4844×4452, rest point below the screen. Margins zeroed through `set-property` | AI | UI state dump from a throwaway scenario; joystick visible |
| 17:20 | `tools/scenarios/drive.mjs`: in-page autopilot steering on every engine frame (`EVENT_BEFORE_UPDATE`), penetration probe after every frame; route through the arena, rams (wall, shredder, corner), camera follow, tier zoom through the event bus, **real touches** (CDP `Input.dispatchTouchEvent`; `check-html` now emulates a touch phone and gives scenarios `t.touch`) | AI | All checks green on the first GPU run |
| 17:26 | Screenshot review: the body circle sat on the pivot, so the bucket (0.67 in front of the circle) would sink into far-side rocks → `bodyOffset` 0.55: the circle covers the whole machine, turning stays around the tracks | AI (flagged to the user as a taste call) | Far-wall shot: the bucket stops at the rock face; new unit tests |
| 17:28 | "Scrape along the wall" stuck: a free-space profile at 0.25 u showed a rock corner jutting out ahead (a pocket) — level geometry, not a bug; the check moved to a straight stretch | AI | ASCII profile from a throwaway scenario |
| 17:32 | Build (35 s) → pack: **2.61 MB** (+1.04 MB). Cause: Tractor1.glb — embedded zombie texture 512² RGBA PNG 409 KB, body texture 94 KB, meshes 290 KB with tangents although no material uses a normal map | AI | Build file listing; left for a size pass (PLAN risks) |
| 17:35 | `file://` in SwiftShader (6–7 fps): corner penetration **0.074** > 0.05 (0.036 at 60 fps). Dumped the 5 real rock boxes of that corner into a unit test: 2 resolve passes leave 0.073 at 4 fps, each pass halves the rest → `collisionPasses` 4 (0.016) | AI | Regression test on the real geometry with the Config tuning; a synthetic 60° wedge had not reproduced it |
| 17:40 | Rebuild → pack → check; pack report now shows the game code separately (`assets/main/index.js`, 27 KB → 11 KB in HTML) | AI | **PASS** portrait + landscape from `file://`, 0 external requests; max penetration 0.014–0.017 (SwiftShader) / 0.008 (GPU); **GPU 60 fps**, start 1.3–2.2 s; 15–17 draw calls (the tractor alone = 9) |
