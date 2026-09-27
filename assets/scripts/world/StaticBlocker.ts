import { _decorator, Component, Enum, MeshRenderer, Node, Quat, Vec3 } from 'cc';
import type { XZBounds } from '../core/Config';
import { Blocks, ObstacleGrid } from './ObstacleGrid';
import type { ObstacleShape } from './ObstacleGrid';

const { ccclass, property } = _decorator;

/** How a blocker describes its footprint. */
export const BlockerShape = Enum({
  /** Box in the node's local XZ, scaled by the node. */
  Box: 0,
  /** Circle around the node, scaled by the node. */
  Circle: 1,
  /** Box fitted to the meshes under the node, aligned with the node's yaw (rocks). */
  MeshBounds: 2,
});

const tmpCorner = new Vec3();
const tmpAxis = new Vec3();
const tmpScale = new Vec3();

/**
 * Marks a level node as static collision for the tractor and/or the balls.
 * Authoring data only: GameRoot turns every blocker into an ObstacleGrid entry at startup.
 */
@ccclass('StaticBlocker')
export class StaticBlocker extends Component {
  @property({ type: BlockerShape })
  shape = BlockerShape.Box;

  @property({ tooltip: 'Half size along local X (Box).', visible(this: StaticBlocker) { return this.shape === BlockerShape.Box; } })
  halfX = 1;

  @property({ tooltip: 'Half size along local Z (Box).', visible(this: StaticBlocker) { return this.shape === BlockerShape.Box; } })
  halfZ = 1;

  @property({ tooltip: 'Radius (Circle).', visible(this: StaticBlocker) { return this.shape === BlockerShape.Circle; } })
  radius = 1;

  @property({ tooltip: 'Shrinks the fitted box: rock meshes are rounder than their bounds.', visible(this: StaticBlocker) { return this.shape === BlockerShape.MeshBounds; } })
  fit = 0.85;

  @property
  blocksTractor = true;

  @property
  blocksBalls = true;

  /** Which movers this blocker stops, as an ObstacleGrid mask. */
  get mask(): number {
    return (this.blocksTractor ? Blocks.Tractor : 0) | (this.blocksBalls ? Blocks.Balls : 0);
  }

  /** The footprint in world XZ; null when there is nothing to block (MeshBounds without meshes). */
  toWorldShape(): ObstacleShape | null {
    const pos = this.node.worldPosition;
    const angle = yawOf(this.node.worldRotation);
    const scale = this.node.getWorldScale(tmpScale);
    switch (this.shape) {
      case BlockerShape.Circle:
        return { kind: 'circle', x: pos.x, z: pos.z, radius: this.radius * Math.max(Math.abs(scale.x), Math.abs(scale.z)) };
      case BlockerShape.MeshBounds:
        return this.fitMeshes(pos, angle);
      default:
        return { kind: 'box', x: pos.x, z: pos.z, halfX: this.halfX * Math.abs(scale.x), halfZ: this.halfZ * Math.abs(scale.z), angle };
    }
  }

  /** Box around every mesh below the node, measured in the node's yaw frame and shrunk by `fit`. */
  private fitMeshes(pos: Readonly<Vec3>, angle: number): ObstacleShape | null {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const renderer of this.getComponentsInChildren(MeshRenderer)) {
      const lo = renderer.mesh?.struct.minPosition;
      const hi = renderer.mesh?.struct.maxPosition;
      if (!lo || !hi) continue;
      const matrix = renderer.node.worldMatrix;
      for (let i = 0; i < 8; i++) {
        tmpCorner.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
        Vec3.transformMat4(tmpCorner, tmpCorner, matrix);
        // World offset -> node yaw frame (inverse rotation about Y).
        const dx = tmpCorner.x - pos.x;
        const dz = tmpCorner.z - pos.z;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        minX = Math.min(minX, lx);
        maxX = Math.max(maxX, lx);
        minZ = Math.min(minZ, lz);
        maxZ = Math.max(maxZ, lz);
      }
    }
    if (minX > maxX) return null;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    return {
      kind: 'box',
      // Box centre from the yaw frame back to world (rotation about Y).
      x: pos.x + cx * cos + cz * sin,
      z: pos.z - cx * sin + cz * cos,
      halfX: ((maxX - minX) / 2) * this.fit,
      halfZ: ((maxZ - minZ) / 2) * this.fit,
      angle,
    };
  }
}

/** Static collision of a level: one grid entry per StaticBlocker below `level`. */
export function buildObstacleGrid(level: Node, bounds: XZBounds, cellSize: number): ObstacleGrid {
  const grid = new ObstacleGrid(bounds, cellSize);
  for (const blocker of level.getComponentsInChildren(StaticBlocker)) {
    const shape = blocker.toWorldShape();
    if (shape) grid.add(shape, blocker.mask);
  }
  return grid;
}

/** Rotation about +Y of a world rotation: the heading of its local +X axis. */
function yawOf(rotation: Readonly<Quat>): number {
  Vec3.transformQuat(tmpAxis, Vec3.UNIT_X, rotation);
  return Math.atan2(-tmpAxis.z, tmpAxis.x);
}
