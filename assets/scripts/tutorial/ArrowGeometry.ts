/**
 * The tutorial arrow's shape, built from code (no model asset): a round shaft and a cone head along +Z,
 * tail at the origin, tip at z = shaftLength + headLength. Smooth side normals, counter-clockwise
 * triangles facing outward. The proportions are those of the example's fallback arrow. Pure TypeScript:
 * no engine imports (the view hands the arrays to the engine's mesh builder).
 */

export interface ArrowShape {
  readonly shaftRadius: number;
  readonly shaftLength: number;
  readonly headRadius: number;
  readonly headLength: number;
  /** Segments round the arrow (at least 3). */
  readonly segments: number;
}

export const ARROW_SHAPE: ArrowShape = { shaftRadius: 0.16, shaftLength: 0.78, headRadius: 0.46, headLength: 0.66, segments: 16 };

export interface ArrowGeometry {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
  readonly minPos: { x: number; y: number; z: number };
  readonly maxPos: { x: number; y: number; z: number };
  readonly boundingRadius: number;
}

export function buildArrowGeometry(shape: ArrowShape = ARROW_SHAPE): ArrowGeometry {
  const { shaftRadius: rs, shaftLength: ls, headRadius: rh, headLength: lh } = shape;
  const n = Math.max(3, Math.floor(shape.segments));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cos: number[] = [];
  const sin: number[] = [];
  for (let i = 0; i < n; i++) {
    cos.push(Math.cos((i / n) * 2 * Math.PI));
    sin.push(Math.sin((i / n) * 2 * Math.PI));
  }
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(0, 0);
    return positions.length / 3 - 1;
  };
  /** A ring of `n` vertices at radius r, height z, with normals from `normal(i)`. */
  const ring = (r: number, z: number, normal: (i: number) => [number, number, number]): number => {
    const first = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const [nx, ny, nz] = normal(i);
      vertex(r * cos[i], r * sin[i], z, nx, ny, nz);
    }
    return first;
  };
  const next = (i: number): number => (i + 1) % n;

  // Tail cap, facing -Z.
  const back = (): [number, number, number] => [0, 0, -1];
  const centre = vertex(0, 0, 0, 0, 0, -1);
  const tail = ring(rs, 0, back);
  for (let i = 0; i < n; i++) indices.push(centre, tail + next(i), tail + i);

  // Shaft side.
  const side = (i: number): [number, number, number] => [cos[i], sin[i], 0];
  const shaftLow = ring(rs, 0, side);
  const shaftHigh = ring(rs, ls, side);
  for (let i = 0; i < n; i++) {
    const j = next(i);
    indices.push(shaftLow + i, shaftLow + j, shaftHigh + j, shaftLow + i, shaftHigh + j, shaftHigh + i);
  }

  // The head's flat underside (an annulus between the shaft and the cone's rim), facing -Z.
  const inner = ring(rs, ls, back);
  const outer = ring(rh, ls, back);
  for (let i = 0; i < n; i++) {
    const j = next(i);
    indices.push(inner + i, outer + j, outer + i, inner + i, inner + j, outer + j);
  }

  // The cone: its normal leans forward by rh / lh; every segment has its own apex with its mid-angle normal.
  const slope = Math.hypot(lh, rh);
  const cone = (i: number): [number, number, number] => [(cos[i] * lh) / slope, (sin[i] * lh) / slope, rh / slope];
  const rim = ring(rh, ls, cone);
  for (let i = 0; i < n; i++) {
    const j = next(i);
    const mid = Math.atan2(sin[i] + sin[j], cos[i] + cos[j]);
    const apex = vertex(0, 0, ls + lh, (Math.cos(mid) * lh) / slope, (Math.sin(mid) * lh) / slope, rh / slope);
    indices.push(rim + i, rim + j, apex);
  }

  const reach = Math.max(rs, rh);
  return {
    positions,
    normals,
    uvs,
    indices,
    minPos: { x: -reach, y: -reach, z: 0 },
    maxPos: { x: reach, y: reach, z: ls + lh },
    // Half the diagonal of the bounds: a sphere round the box.
    boundingRadius: Math.hypot(reach, reach, (ls + lh) / 2),
  };
}
