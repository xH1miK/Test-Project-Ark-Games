/**
 * The vertex data of the puffs: one camera-facing quad per visible puff, in world space, 9 floats a
 * vertex (position, uv, colour rgba 0..1), quads packed from the start of the buffer. Pure TypeScript:
 * no engine imports. PuffRenderer uploads it.
 */

import { PuffKind } from './Puffs';
import type { Puffs } from './Puffs';

export const FLOATS_PER_VERTEX = 9;
export const FLOATS_PER_QUAD = 4 * FLOATS_PER_VERTEX;

/** A tile of the puff atlas: u range (v is 0..1). */
export interface Tile {
  readonly u0: number;
  readonly u1: number;
}

export interface QuadLook {
  /** Colours 0..255 per kind (dust, spark) and their atlas tiles. */
  readonly colors: readonly [readonly number[], readonly number[]];
  readonly tiles: readonly [Tile, Tile];
}

const CORNERS = [
  [-1, -1, 0, 1],
  [1, -1, 1, 1],
  [1, 1, 1, 0],
  [-1, 1, 0, 0],
] as const;

/** Index buffer for `capacity` quads (two triangles each). */
export function quadIndices(capacity: number): Uint16Array {
  const idx = new Uint16Array(capacity * 6);
  for (let q = 0; q < capacity; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  return idx;
}

/**
 * Writes the visible puffs as quads facing along `right` (rx, ry, rz) and `up` (ux, uy, uz), the
 * camera's axes; returns how many quads it wrote (the first `quads * 6` indices draw them).
 */
export function writeQuads(out: Float32Array, puffs: Puffs, look: QuadLook,
  rx: number, ry: number, rz: number, ux: number, uy: number, uz: number): number {
  let q = 0;
  for (let i = 0; i < puffs.capacity; i++) {
    if (!puffs.visible(i)) continue;
    const half = puffs.size(i) / 2;
    const a = (puffs.rotation(i) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const kind = puffs.kind[i] === PuffKind.Spark ? 1 : 0;
    const col = look.colors[kind];
    const tile = look.tiles[kind];
    const alpha = puffs.alpha(i);
    let o = q * FLOATS_PER_QUAD;
    for (let k = 0; k < 4; k++) {
      const corner = CORNERS[k];
      // The corner turned about the view axis, then spread along the camera's right and up.
      const cx = (corner[0] * c - corner[1] * s) * half;
      const cy = (corner[0] * s + corner[1] * c) * half;
      out[o++] = puffs.x[i] + rx * cx + ux * cy;
      out[o++] = puffs.y[i] + ry * cx + uy * cy;
      out[o++] = puffs.z[i] + rz * cx + uz * cy;
      out[o++] = tile.u0 + (tile.u1 - tile.u0) * corner[2];
      out[o++] = corner[3];
      out[o++] = col[0] / 255;
      out[o++] = col[1] / 255;
      out[o++] = col[2] / 255;
      out[o++] = alpha;
    }
    q++;
  }
  return q;
}
