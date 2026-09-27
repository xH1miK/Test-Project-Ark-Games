/**
 * Every gameplay tunable in one place (starting numbers from docs/GDD.md).
 * Plain data with no engine imports, so pure models and Node tests can read it.
 * Tune numbers here, never inside components.
 */

/** Stats of one tractor tier. Tier 1 is index 0. */
export interface TractorTierConfig {
  /** Top speed, units/s. */
  readonly speed: number;
  /** Balls the bucket can hold. */
  readonly bucketCapacity: number;
  /** Radius of the body circle used against static obstacles. */
  readonly bodyRadius: number;
  /**
   * How far ahead of the pivot the body circle sits. The pivot is the turning point between the
   * tracks; the circle is centred over the whole machine, bucket included, so the bucket stops at a wall.
   */
  readonly bodyOffset: number;
}

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
      { speed: 3.6, bucketCapacity: 8, bodyRadius: 1.2, bodyOffset: 0.55 },
      // Tractor2: bodyOffset to be measured when its model goes in (progression stage).
      { speed: 8.4, bucketCapacity: 60, bodyRadius: 1.8, bodyOffset: 0 },
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
    maxStep: 1 / 30,
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
    /** Balls spawned on the field at start; there is no respawn. */
    count: 1500,
  },

  economy: {
    coinsPerBall: 2,
    upgradePrice: 100,
    gatePrice: 300,
  },

  shredder: {
    /** Half size of the square hand-in zone around the shredder pivot. */
    zoneHalf: 3.5,
  },

  pads: {
    /** Half size of the square zone the tractor has to stand in. */
    zoneHalf: 3.1,
    /** The full price streams onto a pad within this time, s. */
    fillTime: 1.55,
  },

  coinFx: {
    flightTime: 0.45,
    spritesPerPayout: 6,
    maxAlive: 20,
  },

  ui: {
    /** Portrait design frame; the UI scales to fit any aspect ratio. */
    designWidth: 1280,
    designHeight: 2276,
  },
} as const;
