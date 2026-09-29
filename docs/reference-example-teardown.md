# Reference: "Zombie Miner" example playable — teardown

Source: `ExamplePlayable.html` from the employer (Cocos Creator **3.8.8** build, launch scene `Main_HookGirl`).
Method: unpacked the embedded file table, split the compiled bundle per module, decoded the packed scene JSON,
and read live component values from the running game in a browser (AI-driven: Claude Code + subagents).

**Policy:** this is a *behaviour and numbers* reference. We do not copy the example's code or shaders —
our implementation is written from scratch.

Tags: [R] read directly from code/scene, [I] inferred.

## 1. Scenario (lower floor = our whole scope)

Layout (world XZ, y=0) [R]: tractor start (9, 0, −11) facing +Z · shredder (5.75, −0.19, −1.85) rotY 90 scale 0.47 ·
upgrade pad (5.65, 0.02, 2.33) · gate pad (1.3, 0.02, −12.2), price sign (1.3, 4, −13.35) · GateHouse (0,0,−20) scale 8 ·
gate blocker ≈(1.1, −13.9) half 3.34×0.3 · ball bounds X −5.9..15.1, Z −21..16. Rocks form the arena walls.

0. Load: sounds from `resources/Sounds`, music requested, mute button created, upgrade pad hidden, gate pad (300) visible, force-field curtain built over the gate blocker, intro starts.
1. Intro camera cutscene 6.3 s (input ignored), last waypoint snapped to the follow pose, then `tutorial.begin()`. *(We skip the intro.)*
2. Free play: joystick drives the tractor; driving into balls scoops them into the bucket (tier 1 = **8 balls**), click sound per ball. Full bucket just pushes balls like a blade.
3. Shredder hand-in: tractor pivot inside square zone |dx|,|dz| ≤ 3.5 → whole load flies in arcs within ~0.1 s, **2 coins/ball**, rollers spin + grind loop, coin sprites fly shredder → HUD (purse credited on landing). **First hand-in reveals the upgrade pad** (pop-in 0.35 s backOut + radial ball burst r 2.8). Balls shoved into the shredder "throat" also pay 2 each.
4. Upgrade pad (square ±3.1): standing on it streams coins HUD → pad; label counts down 100 → 0; partial payment kept; on fill → tractor tier 2, pad shows "MAX".
5. Gate pad: same mechanic, **300**. On purchase: Purchase sfx, blocker off, curtain opens (0.85 s), pad + sign shrink away (0.25 s backIn). **For us: end of run here** (finish tutorial, disable input, end state).

## 2. Tutorial

Two markers built from an arrow model (lit, colour (60,255,80), no shadows):
- **Path arrow** anchored to the tractor: `pos = tractor + (sin(yaw)·3.2, 1.5, cos(yaw)·3.2)`, yaw toward goal, turns 540°/s, scale 1.4.
- **Pointer** over the target: bobbing amplitude 0.15, period 1.1 s, euler (60, 45, 0) so it leans to the camera, scale 1.54.

Steps (re-evaluated every frame): Off → **Sell** (arrow → shredder, pointer at +3) → **Upgrade** (pad at +2.5) → **Gate** → Done.
`aimPad` rule: if purse is 0 and the pad still needs coins, aim at the shredder instead of the pad. Coins still flying don't count.
Markers hide if their target is inactive.

## 3. Tractor

Drive (no physics) [R]: joystick is camera-relative XZ, magnitude 0..1. Desired heading `atan2(x, −y)`; `n` = shortest signed angle.
Target speed `moveSpeed·|input|·max(0, cos n)` (slows while turning, tank-like). Accel 14 u/s², brake 22 u/s².
Turn rate `240°/s · (0.75 + 0.25·speed/moveSpeed)` clamped to error. `pos += (sin yaw, cos yaw)·speed·dt` (model forward +Z).
Then resolve circle vs static obstacle grid (2 passes). Engine loop sound while speed > 0.01.

| Tier | Speed | Body radius | Bucket capacity | Model |
|---|---|---|---|---|
| 1 | 3.6 | 1.2 | 8 | Tractor1 |
| 2 | 8.4 | 1.8 | 60 | Tractor2 |

Level-up: new model swells 0.55× → 1× in 0.35 s backOut, Upgrade sfx, dust ring (12 puffs, r 2.4), bucket shape/capacity switch,
camera zoom `1.2^(level−1)` over 0.5 s smoothstep.

Bucket = kinematic compound of boxes in tractor local space (x side, y up, z forward):
- Tier 1: body halfX 0.85, y 0–1.3, z −0.77..1.03; bucket halfX 0.74, floor 0.02, rim 0.75 (+2 ball layers heap), z 1.03..1.73.
- Tier 2: body halfX 1.5, top 3, back −1.37; bucket halfX 1.7, floor 0.05, rim 1.4, z 1.82..3.07.
- Intake = bucket cavity extended forward by one ball radius; awake balls inside get captured while not full (keep 90% relative velocity).
- Full → intake acts as a solid pusher. Push: project balls out of boxes + kick (pushSpeed 3 × penetration × tractor speed), shed sideways at the front; balls above 2.2 ignored; tractor never slowed by balls.
- Carried balls: small local particle pile (gravity 28, damping 2.5/s, 4 separation passes, sleeps 0.8 s after disturbance), drawn by the same ball renderer.

Hand-in flight: lerp + `sin(πt)·arc` hop, duration 0.32·(1..1.4) s, arc 1.4, target shredder + (0, 0.5, 0) ± 0.6, dust puff on landing.

Pay pads: first coin at once, then 1 per 0.07 s, quadratically accelerating so the full price finishes within 1.55 s.
Each chunk leaves the purse immediately, flies as coin sprites HUD → pad, deposited on landing. Label shows what's still owed.

## 4. Balls

Custom position-based sim, no engine physics [R]. Radius 0.275 (±5% cosmetic), gravity 28, restitution 0.1, ground friction 16, ground drag 1/s,
air drag 0.71/s, climb 0.35, knock 0.25, edge band 2.5 / push 3, world collision on.
- SoA typed arrays; 3D uniform grid (cell = diameter); dt capped 1/30; predict → scoop → 2 iterations of ball–ball + pusher + obstacles → velocity from Δpos; resting threshold 0.35, slop 0.02.
- **Sleeping**: only balls in "hot" cells (near the moving pusher or a moving ball, hot for 4 frames) are simulated.
- Spawn once: hex lattice, jitter 0.45·step, coverage 0.78 (step ≈ 0.593), 40 relax passes, patch centre (4.84, −2.03) half 9.2×17.7 → **≈1600 balls**. Holes: circle r 3.2 at tractor start, 4×3.7 box at shredder, 18.6×7.3 box at gate apron. **No respawn.**
- Shredder throat sink: oriented box ±1.8×±1.95, scans 600 balls/frame round-robin, swallowed balls fly 0.16 s and pay 2 each.
- Rendering: one dynamic mesh per field = **1 draw call**, 4 verts/ball (quad expanded in the vertex shader from camera basis), fragment shader ray-traces a sphere impostor (hemisphere ambient, sun diffuse+spec, fresnel rim, rotating pattern for visible rolling). Only moved balls rewritten. No shadows. Colour (32,127,151), metal 0.85.

## 5. Economy

Purse starts at 0, grows when coin sprites land. Ball = 2 coins. Prices: upgrade **100**, gate **300**.
Pacing: T1 trip 8 balls = 16 coins (throat shoving adds more); T2 trip 60 balls = 120 coins.
Coin FX: ≤6 sprites per payout, ≤20 alive, flight 0.45 s ±18%, quadratic Bézier arc 260 UI units, smoothstep, spin 420°, pop 1.45× → 76 px.

## 6. Gate opening

Force-field curtain (unlit, vertex-coloured magenta sheet + rim + spark diamonds, ≈6.67×3.65). Bump before purchase → flash (fade 0.42 s, cooldown 0.48 s).
Open 0.85 s: hold 15%, then sheet/rim scale Y 1→0 while rising + fading, sparks flash `sin(πt)`, node off.

## 7. Sounds

| Id | Volume | Throttle | When |
|---|---|---|---|
| Theme (music) | 0.3 × 0.35 | — | loop from first touch |
| Engine (loop) | 0.04 | — | tractor moving |
| GetStone (5 billiard variants) | 0.28 (×0.8–1.2) | 55–125 ms | each ball scooped |
| Grind (loop) | 0.22 × roller speed | — | shredder rollers turning |
| PayCube (5 coin variants) | 0.055 (×0.7–1.3) | 200 ms | coin lands in HUD |
| SpendCoins | 0.08 | 90–160 ms | coins fly to a pad (variant steps up with progress) |
| Upgrade | 0.65 | — | tier-up |
| Purchase | 0.65 | — | gate bought |

Also in the example's `SoundTable` (found in S1, 29.09): **`GateOpen`** (`gate_whoosh`) volume 0.55, min interval 1 s — played by `Gate.open()`, i.e. at the same moment as `Purchase` when the gate is bought (so the finale = purchase + whoosh; the table above missed it). `Win` (`win_sound`) 0.25 belongs to the packshot (out of scope); `Button` (`common_button`) 0.7 is the CTA's; the mute button is silent. The music plays from the first gesture (`Sfx.playMusic(Theme)`); engine and grind are `setLoop(id, on)` (grind also `setLoopGain` by roller speed).

Measured on the example's clips (S1; audio pulled out of `reference/example` by `tools/audio/extract-reference.mjs` for measuring only, never shipped; `tools/audio/analyze.mjs`, Chrome's decoder, mono mix; file names are UUIDs, so the role is inferred from length, level and spectrum):

| Role | Length | Peak / RMS (dBFS) | Centroid, bands <150 / <600 / <2.5k / <8k | Notes |
|---|---|---|---|---|
| Theme | 80.8 s | 0.0 / −12.6 | 284 Hz; 28 / 69 / 4 / 0 % | flat level, fades at both ends (0.6 s in, 1.7 s out) |
| Engine loop | 2.7 s | 0.0 / −7.5 | 184 Hz; 88 / 5 / 7 / 0 | near full scale, no silence at the ends (gapless) |
| Grind loop | 4.2 s | −7.4 / −22.4 | 995 Hz; 17 / 51 / 19 / 14 | steady, crunchy (crest 15 dB) |
| Ball click ×5 | 0.06–0.11 s | −10 / −25 | 780–1250 Hz; 97% in 0.6–2.5k | tonal "tok", fast decay |
| Coin ×5 | 0.2–0.3 s | −12 / −35 | 2350–2940 Hz; 24–46% in 0.6–2.5k, 53–75% in 2.5–8k | metallic clink |
| Upgrade | 0.6 s | −3 / −22 | 467 Hz; 14 / 68 / 18 | swells for ~0.25 s, then decays |
| Purchase | 0.7 s | −12 / −24 | 480 Hz; 0 / 91 / 9 | strikes at once, decays |
| Gate whoosh | 2.3–2.6 s | 0 / −20 | 330–970 Hz | swell peaking mid-clip |

Effective level at the table's gains (RMS + 20·log10 gain): music −32, engine −35, grind −35 (at full roller speed) — the three loops sit together near −35 dBFS; the events (upgrade, gate) are the loud ones (peak −7 dBFS). Our clips are calibrated to these file levels, so the same gains make the same mix.

Sfx engine: unlock on first DOM gesture; retry music/loops every 0.5 s until unlocked; pool ≤24 voices; ≤4 one-shots/frame;
per-id min/max interval; never repeat last variant; mute stops all and remembers loops. Cocos AudioSource has no pitch → use variants.
Mute button: 100×100 bottom-left, icon drawn with Graphics.

## 8. UI

UiFit: UI authored for a 1280×2276 portrait frame; `n = min(w/1280, h/2276)`, `setDesignResolutionSize(w/n, h/n, FIXED_WIDTH)` on every resize → works in portrait and landscape.
Joystick: floating, full-screen touch area, base rests bottom-centre 300 up, radius 220, knob 80, deadzone 0.08, idle opacity 150, eases back on release, output camera-relative.
Coin HUD top-right: plate 256×90, icon 128, bold label size 100 + outline 5, punch 1.16× over 0.14 s.
World-space pads: RenderRoot2D lying flat (rotX −90, scale ~0.013), sprite + price label, depthTest on / depthWrite off.

## 9. Rendering / perf / size

No physics module in the build; no shadows; pooled FX with global caps (dust ≤300, coins ≤20); procedural meshes (arrow fallback,
curtain, dust texture); tread UV scroll by driven distance; static XZ obstacle grid (2-unit cells, circles + AABBs; rock walls from mesh AABBs).
Camera: perspective, default FOV, offset (17.08, 24.15, 17.08)·zoom (~34 units), pitch −45, yaw 45, damping pos 0.18 s / rot 0.12 s, dead zone 0.15.
One directional light (illuminance 70000). Splash disabled. Unpacked assets 6.7 MB; cc.js 1.8 MB raw. Loader caps devicePixelRatio at 2.

## 10. Their packer (reference for our fallback)

Single HTML: `window.__PWDATA__ = [[path, kind, mime, base64], ...]` (kind: z = gzip, i = image, a = audio) + inline loader that:
maps engine URLs to embedded paths; overrides `fetch`, `XMLHttpRequest`, and `src` setters of Image/Media/Script elements;
gunzips via `DecompressionStream` with a hand-written inflate fallback (old Safari); caps DPR at 2; waits for MRAID `ready` (≤1.5 s);
evals polyfills + SystemJS, then `System.import('./index.js')`; hides the HTML loader after the first rendered frame.
