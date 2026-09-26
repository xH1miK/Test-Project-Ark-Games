# Setup

How to reproduce the working environment from scratch (Windows 11).

1. **Cocos Dashboard** → sign in → Installs → Install Editor → **3.8.8** (lands in `C:\ProgramData\cocos\editors\Creator\3.8.8`).
2. Clone this repo to an **ASCII path without spaces, outside OneDrive** (e.g. `C:\dev\Test-Project-Ark-Games`) and add it in Dashboard → Projects → Add.
3. **MCP for AI tools** (Funplay Cocos MCP, MIT):
   ```bash
   git clone --depth 1 --branch v0.6.4 https://github.com/FunplayAI/funplay-cocos-mcp.git extensions/funplay-cocos-mcp
   ```
   - `funplay-cocos-mcp.config.json` (committed) pins the server to `http://127.0.0.1:25720/` with the `full` tool profile and autostart.
   - `.mcp.json` (committed) registers it for Claude Code as server `cocos`.
   - Open the project in Cocos Creator → the server starts with the editor. Check: `http://127.0.0.1:25720/health`.
   - Start Claude Code in the project folder and approve the `cocos` server.
   - Reviewed before install: network use is limited to a GitHub release check (no auto-install); it writes client configs only from the panel's "One-Click Configure", which we don't use.
4. The 3D pack `ZM_3DPack` is committed under `assets/` with its `.meta` files (UUIDs preserved as the pack README requires).
5. Art sources live in `art-src/` (GPT-image output, prompts in `art-src/PROMPTS_USED.md`); processed sprites are generated into `assets/` by `tools/`.
