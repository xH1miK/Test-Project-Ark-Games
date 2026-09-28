import { _decorator, Component, Node, tween, Vec3 } from 'cc';
import { Config } from '../core/Config';
import type { TractorModel } from './TractorModel';

const { ccclass, property } = _decorator;

const RAD_TO_DEG = 180 / Math.PI;
const tmpScale = new Vec3();

/**
 * The tractor in the scene: places this node where the model is and shows the model of its tier.
 * The tier models (glb prefab instances) are children, with their pivot at the node origin and
 * facing +Z. A tier reached during play swells into its size (Config.tractor.swell); the first
 * render just shows the starting tier.
 */
@ccclass('TractorView')
export class TractorView extends Component {
  @property({ type: [Node], tooltip: 'The tier models, tier 1 first; only the one of the tractor\'s tier is shown.' })
  models: Node[] = [];

  /** Each model's own scale, taken on the first render (GameRoot renders from its onLoad). */
  private rest: Vec3[] | null = null;
  /** Tier shown, 1-based; 0 = nothing yet. */
  private shown = 0;

  /** Applies the model's position, heading and tier (GameRoot calls it every frame). */
  render(model: TractorModel): void {
    this.node.setPosition(model.x, 0, model.z);
    this.node.setRotationFromEuler(0, model.yaw * RAD_TO_DEG, 0);
    const tier = Math.min(model.tier, this.models.length);
    if (tier !== this.shown) this.show(tier);
  }

  private show(tier: number): void {
    const rest = (this.rest ??= this.models.map((m) => m.scale.clone()));
    const arriving = this.shown !== 0;
    for (let i = 0; i < this.models.length; i++) {
      const m = this.models[i];
      tween(m).stop();
      m.setScale(rest[i]);
      m.active = i === tier - 1;
    }
    this.shown = tier;
    if (!arriving || tier < 1) return;
    const { from, time } = Config.tractor.swell;
    const m = this.models[tier - 1];
    m.setScale(Vec3.multiplyScalar(tmpScale, rest[tier - 1], from));
    tween(m).to(time, { scale: rest[tier - 1] }, { easing: 'backOut' }).start();
  }
}
