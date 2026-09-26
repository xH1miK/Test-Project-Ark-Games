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
