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
        bucket: { halfX: 0.68, minZ: 1.16, maxZ: 1.875, floor: 0.07, rim: 0.75 },
        pusher: [
          { halfX: 0.85, minZ: -0.77, maxZ: 1.03, top: 1.3, shut: PusherFace.Front }, // body
          // Bucket: always solid, as high as a full heap (rim + 2 layers); while there is room the
          // scoop takes what is in front of it before this box can shove it, so a full bucket pushes.
          { halfX: 0.74, minZ: 1.03, maxZ: 1.88, top: 1.85, shut: PusherFace.Back },
        ],
      },
      // Tractor2 (sizes from the example): bodyOffset and the bucket to be measured when its model goes in (progression stage).
      {
        speed: 8.4, bucketCapacity: 60, bodyRadius: 1.8, bodyOffset: 0,
        bucket: { halfX: 1.57, minZ: 1.95, maxZ: 3.07, floor: 0.05, rim: 1.4 },
        pusher: [
          { halfX: 1.5, minZ: -1.37, maxZ: 1.82, top: 3, shut: PusherFace.Front },
          { halfX: 1.7, minZ: 1.82, maxZ: 3.07, top: 2.5, shut: PusherFace.Back },
        ],
      },
    ] as readonly TractorTierConfig[],
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
    /** Balls are kept this far off a shown, unpaid pad's plate (beyond its drawn edge), units. */
    clearMargin: 0.3,
    /** A ball on a kept-clear pad rolls off it toward the nearest edge at least this fast, units/s. */
    clearSpeed: 3,
    /** A pad popping up in the carpet throws the balls within `radius` outward (speed at its centre, units/s; hop share of it). */
    burst: { radius: 2.8, speed: 14, hop: 0.2 },
    /** Seconds a pad takes to pop up (backOut) and to shrink away (backIn). */
    popTime: 0.35,
    shrinkTime: 0.25,
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
  },

  ui: {
    /** Portrait design frame; the UI scales to fit any aspect ratio. */
    designWidth: 1280,
    designHeight: 2276,
    /** The coin counter swells to `punchScale` and back over `punchTime` seconds when coins arrive. */
    coinHud: { punchScale: 1.16, punchTime: 0.14 },
  },
} as const;
