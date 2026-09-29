/**
 * Every gameplay tunable in one place (starting numbers from docs/GDD.md).
 * Plain data with no engine imports, so pure models and Node tests can read it.
 * Tune numbers here, never inside components.
 */

/** Faces of a PusherBox, as bits of PusherBox.shut. */
export const PusherFace = { Left: 1, Right: 2, Back: 4, Front: 8 } as const;

/**
 * A solid box of something that shoves balls (the tractor), in its local axes: x to the side,
 * z forward, y up from the ground. Balls are pushed out sideways (in XZ), never onto its top.
 */
export interface PusherBox {
  readonly halfX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Height of the top; a ball whose bottom is above it is left alone. */
  readonly top: number;
  /** Faces a ball is never pushed out through, because another box of the pusher is there (PusherFace bits). */
  readonly shut: number;
}

/**
 * The inside of a bucket, in the tractor's axes (x to the side, z forward, y up from the ground):
 * where carried balls may sit. The pile may heap `Config.bucket.heapLayers` ball layers above the rim.
 */
export interface BucketShape {
  /** Half width between the inner side walls. */
  readonly halfX: number;
  /** Inner back wall and the front lip. */
  readonly minZ: number;
  readonly maxZ: number;
  /** Inner floor and the top of the back wall. */
  readonly floor: number;
  readonly rim: number;
  /** Radius of the rounded edge between the floor and the back wall (0 = a sharp corner). */
  readonly backRound: number;
}

/** Stats of one tractor tier. Tier 1 is index 0. */
export interface TractorTierConfig {
  /** Top speed, units/s. */
  readonly speed: number;
  /** Balls the bucket can hold. */
  readonly bucketCapacity: number;
  /** Inside of the bucket (the carried pile and the scoop's intake). */
  readonly bucket: BucketShape;
  /** Radius of the body circle used against static obstacles. */
  readonly bodyRadius: number;
  /**
   * How far ahead of the pivot the body circle sits. The pivot is the turning point between the
   * tracks; the circle is centred over the whole machine, bucket included, so the bucket stops at a wall.
   */
  readonly bodyOffset: number;
  /** Boxes that shove balls aside, in the tractor's axes (pivot at the origin, +Z forward). */
  readonly pusher: readonly PusherBox[];
}

/** Longest simulation step, s: slower frames are split into several steps (tractor and balls). */
const MAX_STEP = 1 / 30;

export interface XZBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const Config = {
  time: {
    /** Longest frame the simulation accepts, s; after a hitch the game slows down instead of jumping. */
    maxFrameDt: 0.25,
    /** Longest step of the frame loop, s: a slower frame runs tractor and balls in several steps. */
    maxStep: MAX_STEP,
  },

  world: {
    /** Area covered by the static obstacle grid (world XZ); the arena plus its rock walls. */
    bounds: { minX: -16, maxX: 26, minZ: -32, maxZ: 26 } as XZBounds,
    /** Obstacle grid cell size, units. */
    cellSize: 1,
  },

  tractor: {
    tiers: [
      // Tractor1 spans z -0.77..1.88 around its pivot (bucket in front), half width 0.85.
      {
        speed: 3.6, bucketCapacity: 8, bodyRadius: 1.2, bodyOffset: 0.55,
        // Measured on the mesh: inner side walls at ±0.67..0.69, floor plate ~0.06, teeth tips at z 1.875;
        // the back wall is a curve (z 1.1 at mid height, 1.45 at the floor), so a ball centre stays at
        // z >= ~1.44 -> the wall plane at 1.16. The back is 0.75 high, the sides slope down to 0.15 at the lip.
        bucket: { halfX: 0.68, minZ: 1.16, maxZ: 1.875, floor: 0.07, rim: 0.75, backRound: 0 },
        pusher: [
          { halfX: 0.85, minZ: -0.77, maxZ: 1.03, top: 1.3, shut: PusherFace.Front }, // body
          // Bucket: always solid, as high as a full heap (rim + 2 layers); while there is room the
          // scoop takes what is in front of it before this box can shove it, so a full bucket pushes.
          { halfX: 0.74, minZ: 1.03, maxZ: 1.88, top: 1.85, shut: PusherFace.Back },
        ],
      },
      // Tractor2 at the scene's scale 1.2 (as the example's) spans z -1.37..3.32 around its pivot, half
      // width 1.7 (the bucket); the body behind the bucket ±1.58 up to 3.0, the tracks ±1.51.
      // Measured on the mesh (tools/measure-tractor.mjs): a ball fits down to the floor plate at 0.14,
      // between side walls at ±1.58, the teeth tips at z 3.32 (the plate's edge 3.0-3.06); the back
      // wall is a curve: the second layer touches it at 2.05, a floor ball only at 2.32 -> the wall
      // plane at 2.05 with the floor edge rounded by 0.54. The back is 1.4 high, the sides slope down
      // to 0.18 at the lip.
      {
        speed: 8.4, bucketCapacity: 60, bodyRadius: 1.8, bodyOffset: 0.97,
        bucket: { halfX: 1.58, minZ: 2.05, maxZ: 3.32, floor: 0.14, rim: 1.4, backRound: 0.54 },
        pusher: [
          { halfX: 1.58, minZ: -1.37, maxZ: 1.88, top: 3, shut: PusherFace.Front },
          { halfX: 1.7, minZ: 1.88, maxZ: 3.32, top: 2.5, shut: PusherFace.Back },
        ],
      },
    ] as readonly TractorTierConfig[],
    /** A new tier's model swells from `from` of its size to full over `time` seconds (backOut). */
    swell: { from: 0.55, time: 0.35 },
    /** Maximum turn rate, degrees/s. */
    turnSpeed: 240,
    /** Acceleration and braking, units/s². */
    accel: 14,
    brake: 22,
    /**
     * Circle-vs-obstacle resolve passes per step (stops early once nothing pushes). Pockets between
     * rotated rocks need 4 to stay under 0.05 penetration at 4 fps; each pass halves what is left.
     */
    collisionPasses: 4,
    /** Longest movement step, s; slower frames are split into several steps. */
    maxStep: MAX_STEP,
  },

  /** The load in the bucket (a small pile in the tractor's axes; numbers from the example). */
  bucket: {
    /** Ball layers the pile may heap above the rim; higher up it narrows into a mound. */
    heapLayers: 2,
    /** How much the pile narrows per unit of height above the heap's top (each side). */
    heapSlope: 1.4,
    /** Share of its speed relative to the tractor a scooped ball keeps as it drops in. */
    keep: 0.9,
    /** Share of horizontal speed a carried ball loses per second. */
    damping: 2.5,
    /** Contact passes per step (every pair of carried balls is tested). */
    passes: 4,
    /**
     * Share of the diameter two carried balls may overlap before they are pushed apart: a squeezed
     * load sits lower and wider in the bucket. 0.1: T1's 8 top out at ~1.4 like the example's
     * (whose load overlaps by 0.08-0.17 units); 0.02 stacks them two wide up to ~1.9.
     */
    contactSlop: 0.1,
    /** The pile goes to sleep this long after the last disturbance (a ball taken or handed over), s. */
    settleTime: 0.8,
    /** A ball scooped at the lip is drawn inside the walls at this speed, units/s (it is not snapped in). */
    drawIn: 4,
    /** Fastest a carried ball moves inside the bucket, units/s. */
    maxSpeed: 8,
  },

  camera: {
    /** Follow offset from the tractor, world units. */
    offset: { x: 17.08, y: 24.15, z: 17.08 },
    pitch: -45,
    yaw: 45,
    /** Follow smoothing time, s. */
    smoothTime: 0.18,
    /** Zoom-out factor per tier above 1, and how long the zoom takes, s. */
    tierZoom: 1.2,
    zoomTime: 0.5,
    /** Framing by screen shape (see CameraRigSettings): a 9:16 phone is the design frame (ref 0.5625). */
    aspect: { ref: 0.5625, power: 0.5, min: 0.75, max: 1.15 },
    /** The upgrade pad popping up: the camera leans toward it and pulls out a little, then comes back. */
    peekPad: { share: 0.55, zoom: 1.15, inTime: 0.35, holdTime: 0.7, outTime: 0.6 },
    /** The gate opening: the camera pulls out toward the gate and stays (the run is over). */
    /** The start: the camera leans toward the shredder (the first target, off the screen of a tall phone) and comes back. */
    peekStart: { share: 0.4, zoom: 1.2, inTime: 0, holdTime: 1.6, outTime: 1.4 },
    peekGate: { share: 0.65, zoom: 1.3, inTime: 0.9, holdTime: Infinity, outTime: 1 },
  },

  joystick: {
    /** Sizes in UI units of the design frame. */
    radius: 220,
    knobRadius: 80,
    /** Input below this fraction of the radius counts as zero. */
    deadZone: 0.08,
    /** Rest point of the base: horizontally centred, this far above the bottom edge. */
    restHeight: 300,
    /** A touch never puts the base centre closer than this to a screen edge. */
    edgeMargin: 160,
    /** After release the joystick glides back to rest over about this time, s. */
    returnTime: 0.25,
    /** Opacity at rest (0..255); 0 hides the joystick until the first touch. */
    idleOpacity: 140,
  },

  balls: {
    radius: 0.275,
    /** Most balls on the field (the carpet is thinned out to it). Laid once at start, no respawn. */
    maxCount: 1600,

    // Motion (numbers from the example).
    /** Units/s². */
    gravity: 28,
    /** Share of a fall that bounces back off the floor, 0..1. */
    restitution: 0.1,
    /** Constant braking on the ground, units/s²: a ball shoved at 3 u/s stops within a diameter. */
    groundFriction: 16,
    /** Share of horizontal speed lost per second on the ground (on top of the friction) and in the air. */
    groundDrag: 1,
    airDrag: 0.71,
    /** How readily a ball shoved into a resting one rides up onto it (0 = flat row, 0.35 = a berm heaps up). */
    climb: 0.35,
    /** Share of the closing speed a struck ball receives, so a hit knocks the next ball along. */
    knock: 0.25,
    /** Extra speed a ball is thrown off the pusher with, units/s, and the sideways share at its front. */
    pushSpeed: 3,
    plough: 1,

    /** Edges of the field: the rock faces of the arena, a safety net behind the rocks themselves. */
    bounds: { minX: -6.3, maxX: 15.8, minZ: -22.5, maxZ: 19.8 } as XZBounds,
    /** Kerb along the edges: a moving ball within `edgeBand` is pushed back at up to `edgePush` units/s². */
    edgeBand: 2.5,
    edgePush: 3,

    // Solver.
    /** Contact passes per step (3 keeps berm overlaps over 0.1 three times rarer than 2, for +40% time). */
    iterations: 3,
    /** Share of the diameter two balls may overlap without being pushed apart (keeps piles calm). */
    contactSlop: 0.02,
    /** Share of the diameter a resting ball lets a slow neighbour sink in before it gives way. */
    jamDepth: 0.12,
    /** Below this speed, units/s, a supported ball stops. */
    restSpeed: 0.35,
    /** Steps a disturbed cell stays awake; balls in cold cells sleep and cost nothing. */
    hotFrames: 4,

    /**
     * Drawing only (BallRenderer): each ball is drawn 1 ± sizeJitter of the radius and 1 ± shadeJitter
     * bright, seeded. Colour, gloss and pattern live in the material (assets/Materials/Balls.mtl).
     */
    look: { sizeJitter: 0.05, shadeJitter: 0.04, seed: 7 },

    /** The carpet laid at start (world XZ, from the example; the holes sit on our spots). */
    carpet: {
      centerX: 4.84,
      centerZ: -2.03,
      halfX: 9.2,
      halfZ: 17.725,
      holes: [
        { kind: 'circle', x: 9, z: -11, radius: 3.2 }, // tractor start
        { kind: 'box', x: 5.76, z: -1.85, halfX: 2.0, halfZ: 1.85 }, // shredder
        { kind: 'box', x: 4.84, z: -16.1, halfX: 9.3, halfZ: 3.65 }, // apron in front of the gate
      ],
      /** Share of the floor the balls cover before the jitter. */
      coverage: 0.78,
      /** Random offset of each lattice point, share of the lattice step. */
      jitter: 0.45,
      /** Passes that push jittered neighbours apart (the spacing stops changing after 5-10; the example used 40). */
      relaxPasses: 10,
      seed: 1,
    },
  },

  economy: {
    coinsPerBall: 2,
    upgradePrice: 100,
    gatePrice: 300,
  },

  /** The shredder (numbers from the example); where it stands comes from the scene (Level/Shredder). */
  shredder: {
    /** Half size of the square hand-in zone (world axes) the tractor's pivot has to be in. */
    zoneHalf: 3.5,
    /**
     * The load flies in arcs into the shredder: lerp plus a hop of `arc` units at the middle, each
     * ball `time` × (1 .. 1 + stagger) seconds, aimed `aimHeight` above the pivot and scattered up to
     * ±spread in world X and Z (a whole load aimed at one point would read as a single ball).
     */
    handIn: { time: 0.32, stagger: 0.4, arc: 1.4, aimHeight: 0.5, spread: 0.6 },
    /**
     * The throat: free balls shoved into this box (the shredder's own axes, from `depth` below to
     * `height` above its pivot) go down into its mouth (`mouthHeight` above the pivot, scattered
     * ±spread) in `time` seconds with a small hop, and pay as well.
     */
    throat: { halfX: 1.8, halfZ: 1.95, height: 1.1, depth: 2, mouthHeight: -0.15, spread: 0.55, time: 0.16, arc: 0.25 },
    /** Rollers: full speed (degrees/s), seconds to spin up and down, how long a feed keeps them turning. */
    rollers: { speed: 900, spinUp: 0.18, spinDown: 0.6, coast: 0.5 },
    seed: 11,
  },

  /**
   * Pay pads (numbers from the example): the tractor's pivot in the square zone around a pad streams
   * coins from the purse onto it. The first coin goes at once, the next ones every `interval` seconds
   * and faster and faster, so the whole remaining price has left the purse within `fillTime`; each
   * coin counts on the pad when it lands (Config.coinFx flight). A partial payment is kept.
   * Where the pads stand comes from the scene (Level/Spots/UpgradePad, GatePad).
   */
  pads: {
    /** Half size of the square zone (world axes) the tractor's pivot has to be in. */
    zoneHalf: 3.1,
    fillTime: 1.55,
    interval: 0.07,
    /**
     * Balls are kept this far off a shown, unpaid pad's plate (beyond its drawn edge), units. The example
     * keeps 0.3; seen from the camera at 45° a ball that close still covers the plate's near edge.
     */
    clearMargin: 0.5,
    /** A ball on a kept-clear pad rolls off it toward the nearest edge at least this fast, units/s. */
    clearSpeed: 3,
    /** A pad popping up in the carpet throws the balls within `radius` outward (speed at its centre, units/s; hop share of it). */
    burst: { radius: 2.8, speed: 14, hop: 0.2 },
    /** Seconds a pad takes to pop up (backOut) and to shrink away (backIn). */
    popTime: 0.35,
    shrinkTime: 0.25,
  },

  /**
   * The gate (numbers from the example's force-field curtain): after the gate pad is paid the curtain
   * in the gateway holds for `hold` of `openTime`, then folds away (see Gate.fold).
   */
  gate: {
    openTime: 0.85,
    hold: 0.15,
  },

  /**
   * The tutorial's markers (numbers from the example): the path arrow floats `forward` units ahead of
   * the tractor's pivot (along its own heading) `height` above the ground and swings round at
   * `turnSpeed` degrees/s; the pointer bobs by `bob` units (amplitude) every `period` s, its rest
   * position `shredderHeight` over the shredder and `padHeight` over a pad. `look`: both markers are
   * one lit arrow mesh built in code (shaft + cone, tail at the marker's position, tip forward) in
   * this colour (RGB); the path arrow lies flat, the pointer is tipped `pointerPitch` degrees nose down
   * and turned to face the camera's yaw, so it leans over towards the viewer.
   */
  tutorial: {
    arrow: { forward: 3.2, height: 1.5, turnSpeed: 540 },
    pointer: { bob: 0.15, period: 1.1, shredderHeight: 3, padHeight: 4.4 },
    look: { color: [60, 255, 80], arrowScale: 1.4, pointerScale: 1.54, pointerPitch: 60 },
  },

  /**
   * Coins on their way to the purse (the purse is credited when a coin arrives): a payout flies as up
   * to `spritesPerPayout` coins sharing its amount, each `flightTime` ± jitter seconds; with
   * `maxAlive` coins already in the air a payout is credited at once.
   */
  coinFx: {
    flightTime: 0.45,
    jitter: 0.18,
    spritesPerPayout: 6,
    maxAlive: 20,
    seed: 5,
    /**
     * How a coin sprite is drawn on the screen (UI units): it bulges up to `arc` off the straight line
     * (by its lane), spins `spin` degrees, is `size` wide at the end, swells to `pop` times that in
     * the middle of its flight and grows from `startScale` of it over the first `growth` of the flight.
     */
    sprite: { arc: 260, spin: 420, size: 76, pop: 1.45, startScale: 0.5, growth: 0.15 },
  },

  ui: {
    /** Portrait design frame; the UI scales to fit any aspect ratio. */
    designWidth: 1280,
    designHeight: 2276,
    /** Landscape: the frame to fit is this tall (not the whole portrait height), so the HUD and the joystick are not tiny on a wide, low screen. */
    landscapeHeight: 1400,
    /** The coin counter swells to `punchScale` and back over `punchTime` seconds when coins arrive. */
    coinHud: { punchScale: 1.16, punchTime: 0.14 },
    /**
     * The mute button (bottom-left, in the Hud group): the icon is 100 units, the touch area round it `touch` (a finger
     * is bigger than 100 units of a 1280-wide frame: ~30 CSS px on a phone, 49 with the area), `margin` from the corner.
     * Pressed, the icon shrinks to `pressScale` in `pressTime` s and springs back over `releaseTime`.
     */
    muteButton: { icon: 100, touch: 160, margin: 20, pressScale: 0.86, pressTime: 0.06, releaseTime: 0.2 },
  },

  /**
   * The finale (the gate was paid): the title pops up (backOut over `pop` s) `height` of the screen
   * height above the middle and then pulses; confetti fires from the two bottom corners and rains from
   * the top. All sizes and speeds in UI units of the design frame (1280 x 2276 portrait); the confetti
   * fills whatever screen the frame is fitted to.
   */
  /**
   * Dust and sparks (Puffs, drawn as camera-facing quads in one draw call): a pool of `capacity`, the
   * two kinds' look and the recipes the game emits. A recipe: how many, where (a ring of `ring` radius
   * or a box of half sizes `box` round the point), outward `speed` and `up` speed, `life`, `size`
   * (from -> to), `delay` (each puff is born within this many seconds) and `spin` (degrees/s).
   */
  puffs: {
    capacity: 256,
    seed: 23,
    /** Colour (0..255), peak opacity, gravity (units/s², negative falls), drag (share of speed lost per second). */
    dust: { color: [236, 226, 244], alpha: 0.9, gravity: 0.6, drag: 2.2 },
    spark: { color: [255, 214, 170], alpha: 1, gravity: -1.5, drag: 1.2 },
    /** Fade in over this share of a puff's life. */
    attack: 0.12,
    recipes: {
      /** Balls landing in the shredder (one per landing step, more for a big batch). */
      landing: { kind: 'dust', count: 3, y: 1.3, box: [0.7, 0.1, 0.7], speed: 1.4, up: [1, 2.2], life: [0.55, 0.9], size: [1.4, 3], delay: 0.05, spin: 90 },
      /** The upgrade: a ring round the tractor (the example: 12 puffs, radius 2.4). */
      upgrade: { kind: 'dust', count: 12, y: 0.9, ring: 1.8, speed: 2.4, up: [0.3, 0.9], life: [0.7, 1.0], size: [2.2, 4.6], delay: 0.06, spin: 60 },
      /** The upgrade pad popping up. */
      padPop: { kind: 'dust', count: 10, y: 0.7, ring: 2.4, speed: 2.2, up: [0.3, 0.9], life: [0.6, 0.9], size: [2, 4], delay: 0.1, spin: 60 },
      /** The gate opening: sparks all over the doorway, born within the opening time. */
      gate: { kind: 'spark', count: 64, y: 0, box: [2.4, 1.6, 0.15], speed: 0.4, up: [1.2, 3], life: [0.55, 1], size: [1.1, 0.3], delay: 0.7, spin: 0 },
    },
  },

  /**
   * Sound (numbers of the example's sound table, docs/reference-example-teardown.md §7; the clips are
   * calibrated to the example's file levels, tools/audio/sounds.mjs). One-shots: `volume` x a random factor in
   * `jitter`, after a play the next one waits `minInterval..maxInterval` s, the variant never repeats the last
   * one (`random`) or steps with a pad's progress (`progress`). Loops: `volume` at full gain, `fade` seconds
   * to go from silence to full and back. At most `maxShotsPerFrame` one-shots start in a frame and at most
   * `maxVoices` sound at once; until a real gesture unlocks the browser's audio the start of the loops is
   * asked again every `unlockRetry` s after each gesture. Names are the assets of assets/audio.
   */
  sound: {
    maxVoices: 24,
    maxShotsPerFrame: 4,
    unlockRetry: 0.5,
    historySize: 64,
    seed: 17,
    /** The tractor counts as moving (the engine loop runs) above this speed, units/s. */
    engineMinSpeed: 0.3,
    loops: {
      music: { clip: 'music', volume: 0.3 * 0.35, fade: 0.25 },
      engine: { clip: 'engine', volume: 0.040095, fade: 0.15 },
      // Its level is the rollers' speed share, which already ramps.
      grind: { clip: 'grind', volume: 0.22, fade: 0 },
    },
    shots: {
      ball: { clips: ['ball_1', 'ball_2', 'ball_3', 'ball_4', 'ball_5'], volume: 0.28, jitter: [0.8, 1.2], minInterval: 0.055, maxInterval: 0.125, pick: 'random' },
      coin: { clips: ['coin_1', 'coin_2', 'coin_3', 'coin_4', 'coin_5'], volume: 0.055, jitter: [0.7, 1.3], minInterval: 0.2, maxInterval: 0.2, pick: 'random' },
      // The pad's coins: the same clinks, rising in pitch as the price fills.
      spend: { clips: ['coin_1', 'coin_2', 'coin_3', 'coin_4', 'coin_5'], volume: 0.08, jitter: [1, 1], minInterval: 0.09, maxInterval: 0.16, pick: 'progress' },
      upgrade: { clips: ['upgrade'], volume: 0.65, jitter: [1, 1], minInterval: 0, maxInterval: 0, pick: 'random' },
      purchase: { clips: ['purchase'], volume: 0.65, jitter: [1, 1], minInterval: 0, maxInterval: 0, pick: 'random' },
      gate: { clips: ['gate'], volume: 0.55, jitter: [1, 1], minInterval: 1, maxInterval: 1, pick: 'random' },
    },
  },

  finale: {
    title: { text: 'GATE OPEN!', pop: 0.45, height: 0.26, pulseScale: 1.05, pulsePeriod: 0.9 },
    confetti: {
      count: 140,
      /** Share fired from the bottom corners (the rest rains from the top over `rainDelay` s). */
      cannonShare: 0.6,
      /** Units/s²: a fired piece falls fast, a rain piece drifts. */
      gravity: 1900,
      rainGravity: 500,
      /** Share of speed lost per second. */
      drag: 0.9,
      /** Muzzle speed of a fired piece, units/s, and its angle above the horizontal, degrees. */
      speed: { min: 1500, max: 2700 },
      angle: { min: 58, max: 82 },
      rainDelay: 1,
      /** Seconds a piece lives (fired, rain); it fades out over the last `fade` seconds. */
      life: { fired: 2.8, rain: 4.5 },
      fade: 0.5,
      /** Piece size, share of the sprite (32 x 20 units), and how fast it tumbles (degrees/s) and flutters (rad/s). */
      size: { min: 1.1, max: 2.1 },
      spin: 540,
      flutter: { min: 6, max: 14 },
      colors: ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b57bff', '#ff9f1c'],
      seed: 9,
    },
  },
} as const;
