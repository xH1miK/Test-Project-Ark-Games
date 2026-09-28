import { _decorator, Component, Material, RenderingSubMesh, Vec3, director, gfx, renderer } from 'cc';
import type { XZBounds } from '../core/Config';
import { BallQuads, DYNAMIC_STRIDE, STATIC_STRIDE } from './BallQuads';
import type { BallLookSettings, BallSource } from './BallQuads';

const { ccclass, property } = _decorator;

/** Culling box height, units: nothing lifts a ball higher (berms stay under ~2). */
const TOP = 6;

/**
 * Draws every ball in one draw call: one camera-facing quad per ball in a single mesh, shaded as a
 * sphere by the BallImpostor effect (Unity analogy: Graphics.DrawMesh of one procedural mesh with a
 * custom shader instead of a GameObject per ball). Knows no game rules: GameRoot hands it the ball
 * field every frame; it rewrites only the balls that moved (BallQuads) and uploads the dynamic
 * vertex stream once.
 *
 * It owns a render-scene model rather than a MeshRenderer: the dynamic stream is a host-visible
 * buffer (DYNAMIC_DRAW; on iOS the engine re-specifies such a buffer instead of patching one the
 * GPU may still be reading), and nothing else is re-uploaded. The vertices are world positions, so
 * the node must stay at the origin, unrotated and unscaled; put it on a layer the main camera draws.
 */
@ccclass('BallRenderer')
export class BallRenderer extends Component {
  @property({ type: Material, tooltip: 'Material with the BallImpostor effect (assets/effects).' })
  material: Material | null = null;

  private quads: BallQuads | null = null;
  private model: renderer.scene.Model | null = null;
  private mesh: RenderingSubMesh | null = null;
  private dynamicBuffer: gfx.Buffer | null = null;
  private uploads = 0;

  /** The vertex data as last uploaded (QA checks read it). */
  get data(): BallQuads | null {
    return this.quads;
  }

  /** Dynamic-stream uploads so far (one per frame in which some ball moved). */
  get uploadCount(): number {
    return this.uploads;
  }

  /** Builds the mesh for the field's capacity and draws the field as it is (GameRoot calls it once). */
  bind(field: BallSource & { readonly capacity: number }, radius: number, look: BallLookSettings, area: XZBounds): void {
    if (!this.material) throw new Error('BallRenderer: material is not set');
    const root = director.root;
    if (!root) throw new Error('BallRenderer: no engine root');
    this.destroyModel();

    const quads = (this.quads = new BallQuads(field.capacity, radius, look));
    quads.writeAll(field);
    const device = root.device;
    const { BufferUsageBit, MemoryUsageBit, Format } = gfx;
    const buffer = (usage: number, memory: number, data: ArrayBuffer | Uint8Array | Uint16Array, stride: number): gfx.Buffer => {
      const b = device.createBuffer(new gfx.BufferInfo(usage | BufferUsageBit.TRANSFER_DST, memory, data.byteLength, stride));
      b.update(data);
      return b;
    };
    this.dynamicBuffer = buffer(BufferUsageBit.VERTEX, MemoryUsageBit.HOST | MemoryUsageBit.DEVICE, quads.dynamicBytes, DYNAMIC_STRIDE);
    const staticBuffer = buffer(BufferUsageBit.VERTEX, MemoryUsageBit.DEVICE, quads.staticBytes, STATIC_STRIDE);
    const indexBuffer = buffer(BufferUsageBit.INDEX, MemoryUsageBit.DEVICE, quads.indices, 2);
    // Stream 0 (dynamic): centre + radius, orientation; stream 1 (static): corner, shade.
    const attributes = [
      new gfx.Attribute('a_ball', Format.RGBA32F, false, 0),
      new gfx.Attribute('a_spin', Format.RGBA16I, true, 0),
      new gfx.Attribute('a_corner', Format.RGBA8, true, 1),
    ];
    this.mesh = new RenderingSubMesh([this.dynamicBuffer, staticBuffer], attributes, gfx.PrimitiveMode.TRIANGLE_LIST, indexBuffer);

    const model = (this.model = root.createModel<renderer.scene.Model>(renderer.scene.Model));
    model.node = model.transform = this.node;
    model.castShadow = false;
    model.receiveShadow = false;
    model.createBoundingShape(new Vec3(area.minX, -1, area.minZ), new Vec3(area.maxX, TOP, area.maxZ));
    model.initSubModel(0, this.mesh, this.material);
    model.enabled = true;
    if (this.enabledInHierarchy) this.attach();
  }

  /** Rewrites the balls moved since the last call and uploads them (GameRoot calls it every frame, before clearMoved). */
  render(field: BallSource): void {
    if (!this.quads || !this.dynamicBuffer) return;
    if (this.quads.writeMoved(field) === 0) return;
    this.dynamicBuffer.update(this.quads.dynamicBytes);
    this.uploads++;
  }

  protected onEnable(): void {
    this.attach();
  }

  protected onDisable(): void {
    this.model?.scene?.removeModel(this.model);
  }

  protected onDestroy(): void {
    this.destroyModel();
  }

  private attach(): void {
    const scene = this.node.scene?.renderScene;
    if (!this.model || !scene || this.model.scene) return;
    scene.addModel(this.model);
  }

  private destroyModel(): void {
    if (this.model) {
      this.model.scene?.removeModel(this.model);
      director.root?.destroyModel(this.model);
      this.model = null;
    }
    this.mesh?.destroy(); // with its vertex and index buffers
    this.mesh = null;
    this.dynamicBuffer = null;
  }
}
