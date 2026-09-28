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
| 17:48 | The phantom `db://assets/` folder is gone by itself: asset-db dropped it while re-syncing its caches (17:44, during the later file refreshes/build) — `assets/.meta` deleted, no asset with that URL or UUID, no "" path in the library cache. Only an orphan UUID record is left in `library/.assets-data.json` (a cache; disappears on a clean import) | AI | asset-db queries + cache files read; no editor restart needed |

### Review pass (~18:00–18:10), branch `core/m2-joystick-ring`

User review of the M2 screenshots: the joystick knob is fine, the ring is far too thick; the rest (body circle offset, 4 collision passes) approved.

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 18:00 | Asked for a thin joystick ring | human | — |
| 18:02 | Kept the GPT-image ring instead of drawing a new one: `prepare.mjs` got a `ring` step that squeezes the band radially toward the outer edge (0.33 → 0.12 of the radius), sampling along the same angle with premultiplied bilinear filtering, so the gloss, both outlines and the glow stay; `--set`/`--out` to try variants without touching assets | AI | Comparison sheet of 0.08 / 0.12 / 0.16 against the old ring on crops of a real game frame, idle and held; 0.12 chosen (0.08 fades out at idle opacity) |
| 18:05 | Re-imported the PNG through an exact-file `refresh-asset` (UUID and meta unchanged) → build → pack → check | AI | PASS portrait + landscape from `file://`; `drive` scenario green on GPU (60 fps); HTML 2.593 MB (ring PNG 31 → 19 KB) |

## 2026-09-27 (Sun) — Push, M3 groundwork (~18:12–18:28)

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 18:12 | The app header showed "+16,812 −60" on the M3 branch; user asked why so much. It is lines, not files: the diff against GitHub's `main` (last push 13:58, before M1) — 26 commits, 76 files, 12,774 of the lines are `Main.scene` JSON | human → AI | `git diff --shortstat origin/main`; 163 tracked files in total, no build output or node_modules in git |
| 18:19 | Pushed `main` and the milestone branches (M1, M1 look, M2, M2 ring, M3) | AI (on user's request) | Reviewed the file list and grepped the diff for secrets first; header down to the M3 handoff commit |
| 18:22 | M3 groundwork: `tools/scenarios/dump-level.mjs` writes the arena's 32 obstacles and key spots from the running game to `tools/test/fixtures/level.json` (tests and the benchmark will run on the real level); measured Tractor1's body and bucket boxes for the ball pusher; read the example's carpet holes (they sit on our spots) | AI | Fixture spot-checked (shredder and gate-house boxes match the scene) |
| 18:27 | User: do M3 in a new chat. Dropped an unfinished refactor file, put the measurements into the M3 handoff prompt | human → AI | Branch clean |

## 2026-09-27 (Sun) — Stage "Core", M3: balls simulation (~18:29–19:25), branch `core/m3-balls-sim`

New session from the handoff prompt; MCP connected at start.

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 18:29 | Read PLAN/log/GDD/teardown; MCP up. Read the example's `BallField` for behaviour only (step order, sleeping via hot cells, "climb", "knock", plough, kick); our code is written from scratch | AI | — |
| 18:35 | ASCII map of the fixture against the carpet: **a 0.9-wide crack between two south-west corner rocks lets a ball out** (the tractor does not fit). The M1 `level` scenario missed it: its flood fill sampled every 0.5 at .25/.75 offsets and never hit the 0.36 of free room for a ball centre | AI | Fine flood fill in Node (0.1 and 0.05): leak at (−5, 25.9) |
| 18:40 | Plan for M3 told to the user (already approved in the handoff): model, carpet, pusher interface, benchmark, tests, scenario | AI | — |
| 18:45 | `Config.balls` (example numbers, field edges at the rock faces, solver, carpet with holes); pusher boxes per tier in `Config.tractor.tiers` (T1 measured, T2 from the example; faces shared by body and bucket are "shut"); `CircleBlocker` moved to `ObstacleGrid`; `TractorModel.pusherBoxes` (the tractor *is* the balls' pusher) | AI | Typecheck |
| 18:50 | `BallField` (pure TS): SoA typed arrays, XZ grid with a doubly linked list per cell (cell = diameter, a column per cell), hot cells with a 4-step countdown, 3D position-based step (predict → contact passes: ball–ball with slop/jam/climb/knock, floor, pusher boxes with kick and plough, rocks, edges → velocity from displacement, rest, heat). `layCarpet`: seeded hex lattice, jitter, relaxation, holes, thinning to `maxCount` | AI | — |
| 18:52 | Node benchmark `tools/bench/balls.mjs` on the real arena (fixture + autopilot route through the carpet): T1 0.18 ms/frame mean, T2 0.44. Found: balls ending a step in rocks/outside/inside the tractor — a ball moved as someone's neighbour after its own constraints → final pass over the hard limits. Transient overlaps up to 0.36: histogram showed >0.1 in 0.16% of contacts, all in berms → 3 contact passes instead of 2 (>0.1 three times rarer, +40% time) | AI | Benchmark + overlap histogram + CPU profile (no steady-state deopts; the time is contacts in the pile) |
| 18:57 | 16 unit tests (carpet, sleep/wake, moved list, gravity/piles, shut faces, plough, berm, walls, edges, real-arena drives at 60/8 fps, T2). One wrong expectation in my own test (carpet quarters differ because of the holes) | AI | 63/63 green; commit |
| 18:57 | Carpet 45–100 ms → typed arrays and no closures; the spacing settles after 5–10 relax passes (nearest-neighbour stats identical at 10/20/40) → 10 passes: ~43 ms cold, ~7 ms warm, 1468 balls | AI | Nearest-neighbour distribution per pass count |
| 18:57 | Carpet did not fall asleep after a drive: a ball wedged at y 0.43 between neighbours at shallow angles never counted as "supported" (threshold 0.4) and kept its cells hot → support threshold 0.1, separate from who-gives-way (0.4). Tests now check the share of deep overlaps (< 0.5%) plus a spike cap (0.3): a single 0.264 spike in 263k contact-frames | AI | Diagnostic run: asleep 0.7 s after the stop |
| 18:58 | `GameRoot`: carpet from Config; a frame is split into steps ≤ 1/30 s and each step runs tractor then balls (the balls must see the pusher move a little at a time); `balls` on `__zm`. New script metas via an exact-path refresh | AI | Import log clean, 3 new metas only |
| 19:01 | Scene via MCP (commit before, save after): `Level/Walls/Inner/Seal_SW` box blocker over the crack; `level` scenario floods at 0.1 for balls; fixture re-dumped (33 obstacles); Node test floods the fixture at 0.05 | AI | Saved `.scene` read back (33 blockers); the Node test fails on the old fixture, passes on the new; `level` PASS |
| 19:06 | Scenario `balls`: autopilot through the carpet with T1, then the T2 boxes and speed; audit every 4th frame (rocks, arena, NaN); sleep after each stop; ball step time in the browser; a debug overlay (2D canvas projected through the game camera, orange = simulated) for the screenshots. Autopilot moved to `tools/scenarios/lib/autopilot.mjs`, `drive` uses it | AI | Editor preview (GPU): PASS; `drive` re-run PASS |
| 19:08 | Build → pack: **2.600 MB** (+7 KB); `file://` in SwiftShader: FAIL — the per-frame time (7 fps = ~5 steps a frame) and **one ball ended a frame 0.014 inside a rock** (landscape) | AI | — |
| 19:12 | Node repro: routes through the middle did not reproduce; a perimeter route with T2 at a jittery frame time did (132 ball-frames, all at x = 15.525 = the edge clamp). The edge clamp came after the rocks and put a corner ball back into a rock → edges first, rocks last (≤ 4 passes, like the tractor). "Outside" is now checked against a flood-filled arena, not the edge rectangle (the rocks close the arena; the edges are a safety net). Regression test fails on the old code | AI | 66/66 green |
| 19:15 | Rebuild → pack → check | AI | **PASS** portrait + landscape from `file://` (`balls`, `drive`); SwiftShader: step T1 0.3 ms mean / 0.6 p95, T2 0.7 / 1.2; **GPU 60 fps**, step T1 0.42 / 0.7 ms, T2 0.93 / 1.5 ms, 85–93% of the balls asleep; start 1.3–2.3 s |

## 2026-09-28 (Mon) — Review pass: UI on top (~10:55–11:15), branch `core/m3-ui-on-top`

User review of the M3 screenshots: the balls covered the joystick; asked to make the joystick the topmost layer and to keep all future UI grouped on top.

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 10:55 | Asked for the joystick on top of the balls and for all UI grouped on top | human | — |
| 10:57 | Cause: the balls in the M3 shots are the QA overlay (an HTML canvas over the whole game), not the game. In the game the UI camera already renders after the world camera (priority 1073741824 vs 0) and clears depth only, and the joystick is the last Canvas child. Found a real latent problem: the UI camera also saw `UI_3D` (world-space UI such as future pad labels would be drawn twice, once flat over everything) | AI | Camera and Canvas settings read from the saved `.scene` |
| 11:01 | Scene via `tools/mcp.mjs` (the session's native MCP tools had disconnected; the editor's server was up): UI camera sees `UI_2D` only; `Canvas/Hud` group (full-screen Widget, margins set through `scene:set-property`) below `Canvas/Joystick` | AI | Saved `.scene` read back: Camera → Hud → Joystick, visibility 33554432, margins 0 |
| 11:03 | `tools/scenarios/lib/ui-layers.mjs`: UI camera renders last and keeps the colour, only it sees `UI_2D`, everything under the Canvas is on `UI_2D` and nothing else is, the joystick is the topmost group; run by `drive` | AI | PASS both orientations; negative test (joystick under the Hud, world camera after the UI, the tractor on `UI_2D`) → 4 problems reported, FAIL |
| 11:05 | QA overlay cuts every UI sprite out by its own alpha (the sprites sit in the dynamic atlas, so the image comes from the frame's original texture) — the screenshots now show the real layering | AI | `balls` PASS both orientations, GPU 60 fps; shots: joystick ring and knob over the balls, balls visible through the ring's centre |
| 11:08 | Rule for future UI in CLAUDE.md (groups under Canvas, joystick last, no 3D node on `UI_2D`, no camera after the UI camera) | AI | — |

## 2026-09-28 (Mon) — Stage "Core", M4: balls rendering (~11:14–12:40), branch `core/m4-balls-render`

New session from the handoff prompt; MCP connected at start.

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 11:14 | Read PLAN/log/GDD/teardown; MCP up | AI | — |
| 11:16 | Engine source before choosing the mesh: `createDynamicMesh` gives one vertex stream per attribute in device-only buffers (STATIC_DRAW), `updateSubMesh` re-uploads every attribute and copies it into the mesh's CPU copy; for host-visible buffers the engine re-specifies the whole buffer on iOS (`bufferData`) instead of patching one the GPU may still read. → own render-scene `Model` with two streams: dynamic HOST\|DEVICE (centre + radius float32, orientation as a normalised int16 quaternion, 24 B a vertex) and static (quad corner, shade bytes); normalised `RGBA16I` works in both WebGL backends (only `vertexAttribPointer`) | AI | Engine sources + `cc.d.ts` |
| 11:18 | Depth in WebGL 1: the engine's WebGL 1 swapchain enables `EXT_frag_depth`; the effect uses the engine's own idiom (`#pragma extension`, `__VERSION__` guard) | AI | Compiled GLSL read from `library/`: GLSL 1 `#extension GL_EXT_frag_depth` under `#ifdef` + `gl_FragDepthEXT`, GLSL 3 `gl_FragDepth`; only pipeline macros in the defines (one variant per pipeline state) |
| 11:20 | Close-up screenshots of the example's balls (look reference only; its shader was not opened) | AI | FOV 12 shots from the running example |
| 11:30 | `BallQuads` (pure TS) + 7 tests: streams, only moved balls rewritten, rolling direction and angle, int16 packing, drawn = field after every frame of a real drive | AI | 7/7 at the first run; then tiny moves were made to add up (a creep of 1e-6 moves never rolled) + test; one test tolerance of mine was too tight (pending remainder) |
| 11:34 | `BallImpostor.effect`: quad facing the eye sized to the silhouette (r·d/√(d²−r²)), ray–sphere without cancellation, depth, hemisphere + sun + rim, a band and two spots on the ball that roll with it, `CCFragOutput` (ACES + gamma like the other materials) | AI | — |
| 11:37 | `BallRenderer` + GameRoot (`render` before `clearMoved`), `Config.balls.look` (±5% size, ±4% shade, seed) | AI | Strict typecheck, 73 tests |
| 11:38 | Scene via MCP (commit before): `Materials/Balls.mtl` from the scene process (`CC_*` stripped), node `Balls` on Default with BallRenderer, `GameRoot.ballView`; saved | AI | Saved `.scene` read back: the node, the component, two `__id__` renumbered, nothing else |
| 11:39 | First editor preview: impostors right at once (silhouettes, balls overlapping each other correctly), 60 fps | AI | Screenshot |
| 11:40 | Look tuning against the example in 6 rounds of contact sheets (close-up and play distance): the metal look mirrors its own sky/ground colours (the scene's blue ambient turned the balls steel-blue), roughness (soft top-to-bottom gradient instead of a horizon line), floor occlusion of the lower half, softer glint, pattern contrast | AI | Chosen values are the effect's defaults; the material overrides nothing |
| 11:50 | Scenario bug: `waitFor('window.__zm && window.__zm.ballView')` timed out — the page returns values by value and a component never serialises → `!!(…)`; noted in CLAUDE.md | AI | — |
| 11:55 | `balls` scenario for M4: exactly +1 draw call, drawn vs field every 4th frame, no uploads while asleep, rolling (turned ⇔ moved), the joystick over the real balls by screenshot pixels (own PNG reader, byte-identical to sharp), FPS with/without balls, close-ups and a synthetic depth shot (balls put into the bucket, a track, behind the helmet); the circles overlay only with `ZM_BALL_OVERLAY=1` | AI | Preview (GPU): all green except a rolling threshold (10 balls pushed, check wanted more) → the close-up re-aimed ahead of the bucket |
| 12:00 | Build (38 s) → pack: **2.605 MB** (+5 KB) | AI | — |
| 12:02 | SwiftShader from `file://`: portrait FAIL "T2: the carpet is asleep again after the tractor stops" | AI | — |
| 12:04 | Cause, found by replaying the scenario route in Node at 6 fps: three balls wedged on three others each wobbled in a 4-step cycle for ever. Every step gravity sinks a resting ball g·dt² into its supports (0.031 at 1/30 s steps) and the contact passes push it only nearly back; the rest (≤ 0.015) exceeded the fixed stillness share (0.011). At 60 Hz the sink is 4× smaller. A phone at 30 fps would do the same — now visible as shaking balls | AI | Per-step trace of the three balls; a minimal pyramid did not reproduce it, the real berm did |
| 12:08 | Fix in `BallField.finish`: stillness = max(share, g·dt²); a supported ball that moved less is at rest (a knock still counts). Regression test on the same route and frame time (`driveLegs` replays the scenario autopilot) fails on the old code. The sharp-pocket wall test then saw a 7e-7 tail (apex pushes halve the rest; the old code passed by the luck of its trajectories) → tolerance 1e-6, as the browser audit | AI | 74/74; benchmark at 60 fps unchanged (T1 0.21 vs 0.22 ms, T2 0.64 vs 0.70, same sleeping share and overlaps); at 6 fps asleep 0.33 s (T1) / 1.17 s (T2) after the stop |
| 12:11 | Fragment shader in view space: sun direction and pattern axes per vertex, world up = the view matrix's second column, depth from two projection entries — no matrix multiply per pixel | AI | Screenshots vs the previous shader: 0.001% of pixels differ (silhouette edges) |
| 12:13 | Rebuild → pack **2.606 MB**; SwiftShader `balls` from `file://` | AI | PASS portrait + landscape; 6.0 / 6.5 fps and 5.5–6.0 / 6.5 with / without balls; +1 draw call (15 / 18 per frame); knob 97.9–99.2%, ring 98.4–99.2% of pixels drawn over the balls |
| 12:18 | Found: the game runs WebGL 1 everywhere — Feature Cropping (M1) keeps `gfx-webgl` only. So `EXT_frag_depth` is the production path; `check-html --hide-ext EXT_frag_depth` simulates a GPU without it: shader compiles, no errors, balls fall back to the quad's depth (bucket rim cuts them along a plane) | AI | `balls` PASS without the extension; depth shots compared |
| 12:20 | GPU from `file://`: `balls`, `drive`, `level` | AI | PASS portrait + landscape; 60 fps with and without balls; ball step T1 0.39 / 0.7 ms, T2 0.9 / 1.5 ms (mean / p95); drawn vs field worst 9.5e-7; drive: penetration 0.0089, UI on top |
| 12:25 | SwiftShader `drive` from `file://` (the low-FPS corner case of M2) | AI | PASS portrait + landscape, penetration 0.0167 / 0.0155 (≤ 0.05), 6 fps |

## 2026-09-28 (Mon) — Stage "Core", M5: bucket (~12:33–13:40), branch `core/m5-bucket`

New session from the handoff prompt; MCP connected at start (the first two calls were held up by the auto-mode classifier, not the editor).

| Time | What | Who | Verification / notes |
|---|---|---|---|
| 12:33 | Read PLAN/log/GDD/teardown; the example's bucket read for behaviour only (scoop right after predict, held balls leave the grid, a local pile) | AI | — |
| 12:39 | Measured Tractor1's bucket on the mesh (vertices in tractor axes through a scene script): inner side walls ±0.67..0.69, floor plate ~0.06, teeth tips at z 1.875, the back is a curve (a ball centre stays at z ≥ ~1.44), back wall 0.75 high, sides sloping to 0.15 at the lip → cavity box ±0.68 × z 1.16..1.875, floor 0.07, rim 0.75 | AI | 296 bucket vertices |
| 12:42 | Plan told to the user: keep the index and hold the ball out of the field (no repacking: views key size, shade and spin by index; M6 can hide a shredded ball) instead of removal; `Bucket` + `BucketLoad` pure models; the bucket's pusher box stays solid and the scoop runs before the field step, so while there is room nothing in front is shoved and a full bucket pushes; a second write path for carried balls. A subagent sent to screenshot the example's full bucket (look reference) | AI | — |
| 12:43–12:55 | Code: `BallField.hold/place/release/findFree`; `BucketLoad` (all pairs, cavity walls with a slack that shrinks at 4 u/s so a ball scooped at the lip slides in, a mound above rim + 2 layers, sleeps 0.8 s after the last take); `Bucket` (intake = cavity + r ahead, 90% of the speed relative to the tractor, `ballScooped`, follows the tractor's tier, drops what a smaller bucket cannot hold, `unloadAll` for M6); `BallQuads.writeCarried` (turn by Δyaw, roll only along the way inside the bucket; a ball back in the field rolls on from where it is); GameRoot order tractor → scoop → balls → carry | AI | Strict typecheck |
| 12:56 | Tests: 4 red of 95 — 3 were my test mistakes: a ball resting on one neighbour stays put in our carpet sim (M3 design), so "held ball's neighbours fall" became "they wake"; a ball scooped at the lip is legitimately outside the walls while it is drawn in (checks now subtract the slack); a speed check measured the draw-in instead of the kept speed. The 4th was real: 60 balls in the T2 cavity (example sizes) rose into a spike up to 3.8 | AI | Height histograms per slop in Node |
| 13:00 | Subagent report + screenshots: the example's 8 sit one ball deep, 3 wide × 3 layers, overlapping by 0.08–0.17 (walls win), top ~1.6, locked while driving. Ours with a hard pile (slop 0.02) stacked 2 wide up to a centre at 1.86 → `contactSlop` 0.1: T1 top centre ~1.4, overlaps ≤ 0.07; T2's 60 now top out at 2.28 (under the heap top 2.5) | AI (look chosen against the reference) | Slop sweep 0.02 / 0.1 / 0.15 / 0.2 / 0.27 |
| 13:02 | Transient jams traced: a ball dropped into a full bottom layer overlaps by up to 0.23 for 1–2 frames (30 fps), then climbs; at rest ~0.07 | AI | Per-frame trace of the worst pair at 60/30/20/8 fps |
| 13:03 | 95 tests green, commit; exact-path asset refresh of the changed scripts | AI | Import log clean, two new metas only; no scene change needed in M5 |
| 13:05–13:12 | Scenario `scoop` (see CLAUDE.md) + `balls` audits skip held balls; first run on the editor preview (GPU) all green; close-ups moved to the empty start circle (in the carpet the load was lost among the berm) | AI | 8 scoops one event each over 26 frames; full bucket shoved 172 balls; deepest free ball in the tractor 0.011; load outside its cavity 1.7e-16; carried balls' axes vs the tractor's turn 9e-16; 60 fps. `balls` and `drive` PASS on the preview (ball step unchanged: T1 0.40 / 0.70 ms, T2 0.91 / 1.5) |
| 13:13 | Build (40 s) → pack **2.609 MB** (+3 KB) | AI | — |
| 13:15–13:25 | SwiftShader from `file://`: `scoop` and `balls` | AI | PASS portrait + landscape. FPS 3.7 / 4.0 with / without balls vs M4's 6.0 / 6.5: both dropped alike (ratio 0.925 vs 0.923) — a heavy app was running alongside (CPU-bound software GL), not M5 |
| 13:25–13:40 | GPU from `file://`: `scoop`, `balls`, `drive`, `level` | AI | PASS portrait + landscape, 60 fps everywhere (a full parked bucket too), 0 external requests; deepest free ball in the tractor 0.012 / 0.026; ball step T1 0.39 / 0.7 ms, T2 0.87 / 1.5 ms (mean / p95) — as in M4; +1 draw call for all balls, the load included |
| 13:40 | Flagged to the user (decisions within the plan): the bucket box is as high as a full heap (1.85 / 2.5 instead of the rim) so a full bucket does not let berm balls through its heap; the intake takes any free ball in it, asleep or not (the handoff said "awake": a ball there is always next to the moving bucket, except when a bucket empties or grows while parked — then taking it is right); the pile's `contactSlop` 0.1 (a look choice against the example) | AI → human | — |
