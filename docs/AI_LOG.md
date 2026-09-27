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
