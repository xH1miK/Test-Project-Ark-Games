import { _decorator, Camera, Component, Material, RenderingSubMesh, SpriteFrame, Vec3, director, gfx, renderer } from 'cc';
import { Config } from '../core/Config';
import { FLOATS_PER_QUAD, FLOATS_PER_VERTEX, quadIndices, writeQuads } from './PuffQuads';
import type { QuadLook } from './PuffQuads';
import type { Puffs } from './Puffs';

const { ccclass, property } = _decorator;

const STRIDE = FLOATS_PER_VERTEX * 4;
const tmpRight = new Vec3();
const tmpUp = new Vec3();

/**
 * Draws the puffs in one draw call: a render-scene model with one dynamic vertex buffer (rewritten
 * every frame while any puff is alive) and a static index buffer, like BallRenderer. The vertices are
 * world positions, so the node must stay at the origin. The model is switched off when nothing is
 * alive (no draw call at rest). GameRoot hands it the pool and the camera every frame.
 */
@ccclass('PuffRenderer')
export class PuffRenderer extends Component {
  @property({ type: Material, tooltip: 'Material with the Puff effect (assets/effects).' })
  material: Material | null = null;

  @property({ type: SpriteFrame, tooltip: 'The atlas: dust tile on the left half, spark tile on the right.' })
  atlas: SpriteFrame | null = null;

  private puffs: Puffs | null = null;
  private vertices: Float32Array | null = null;
  private look: QuadLook | null = null;
  private sceneModel: renderer.scene.Model | null = null;
  private mesh: RenderingSubMesh | null = null;
  private buffer: gfx.Buffer | null = null;
  private quads = 0;

  /** Quads drawn last frame (QA checks read it). */
  get drawn(): number {
    return this.quads;
  }

  /** The render-scene model (QA checks read it). */
  get model(): renderer.scene.Model | null {
    return this.sceneModel;
  }

  bind(puffs: Puffs): void {
    const { material, atlas } = this;
    const root = director.root;
    if (!material || !atlas || !root) throw new Error('PuffRenderer: material and atlas must be set');
    this.destroyModel();
    this.puffs = puffs;
    material.setProperty('mainTexture', atlas.texture);
    // Half a texel in from the tile edges, so the neighbour tile does not bleed in.
    const w = atlas.texture.width;
    const inset = 0.5 / w;
    const dust = Config.puffs.dust.color;
    const spark = Config.puffs.spark.color;
    this.look = { colors: [dust, spark], tiles: [{ u0: inset, u1: 0.5 - inset }, { u0: 0.5 + inset, u1: 1 - inset }] };
    const capacity = puffs.capacity;
    this.vertices = new Float32Array(capacity * FLOATS_PER_QUAD);

    const device = root.device;
    const { BufferUsageBit, MemoryUsageBit, Format } = gfx;
    this.buffer = device.createBuffer(new gfx.BufferInfo(BufferUsageBit.VERTEX | BufferUsageBit.TRANSFER_DST,
      MemoryUsageBit.HOST | MemoryUsageBit.DEVICE, this.vertices.byteLength, STRIDE));
    this.buffer.update(this.vertices);
    const indices = quadIndices(capacity);
    const indexBuffer = device.createBuffer(new gfx.BufferInfo(BufferUsageBit.INDEX | BufferUsageBit.TRANSFER_DST,
      MemoryUsageBit.DEVICE, indices.byteLength, 2));
    indexBuffer.update(indices);
    const attributes = [
      new gfx.Attribute('a_position', Format.RGB32F),
      new gfx.Attribute('a_texCoord', Format.RG32F),
      new gfx.Attribute('a_color', Format.RGBA32F),
    ];
    this.mesh = new RenderingSubMesh([this.buffer], attributes, gfx.PrimitiveMode.TRIANGLE_LIST, indexBuffer);
    const model = (this.sceneModel = root.createModel<renderer.scene.Model>(renderer.scene.Model));
    model.node = model.transform = this.node;
    model.castShadow = false;
    model.receiveShadow = false;
    // The puffs stay within the level: one big box, never culled while some are alive.
    model.createBoundingShape(new Vec3(-60, -2, -60), new Vec3(60, 12, 60));
    model.initSubModel(0, this.mesh, material);
    model.enabled = false;
    if (this.enabledInHierarchy) this.attach();
  }

  /** Rewrites the quads of the living puffs and uploads them; switches the model off when there are none. */
  render(camera: Camera): void {
    const { puffs, vertices, look, buffer, sceneModel } = this;
    if (!puffs || !vertices || !look || !buffer || !sceneModel) return;
    if (puffs.count === 0) {
      if (sceneModel.enabled) sceneModel.enabled = false;
      this.quads = 0;
      return;
    }
    const node = camera.node;
    Vec3.transformQuat(tmpRight, Vec3.RIGHT, node.worldRotation);
    Vec3.transformQuat(tmpUp, Vec3.UP, node.worldRotation);
    const quads = writeQuads(vertices, puffs, look, tmpRight.x, tmpRight.y, tmpRight.z, tmpUp.x, tmpUp.y, tmpUp.z);
    this.quads = quads;
    if (quads === 0) {
      // Everything alive is still waiting for its delay.
      if (sceneModel.enabled) sceneModel.enabled = false;
      return;
    }
    buffer.update(vertices, quads * FLOATS_PER_QUAD * 4);
    sceneModel.subModels[0].inputAssembler.indexCount = quads * 6;
    if (!sceneModel.enabled) sceneModel.enabled = true;
  }

  protected onEnable(): void {
    this.attach();
  }

  protected onDisable(): void {
    this.sceneModel?.scene?.removeModel(this.sceneModel);
  }

  protected onDestroy(): void {
    this.destroyModel();
  }

  private attach(): void {
    const scene = this.node.scene?.renderScene;
    if (!this.sceneModel || !scene || this.sceneModel.scene) return;
    scene.addModel(this.sceneModel);
  }

  private destroyModel(): void {
    if (this.sceneModel) {
      this.sceneModel.scene?.removeModel(this.sceneModel);
      director.root?.destroyModel(this.sceneModel);
      this.sceneModel = null;
    }
    this.mesh?.destroy();
    this.mesh = null;
    this.buffer = null;
  }
}
