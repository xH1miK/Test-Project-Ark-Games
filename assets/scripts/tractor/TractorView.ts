import { _decorator, Component } from 'cc';
import type { TractorModel } from './TractorModel';

const { ccclass } = _decorator;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * The tractor in the scene: places this node where the model is. The tier models (glb prefab
 * instances) are children, with their pivot at the node origin and facing +Z.
 */
@ccclass('TractorView')
export class TractorView extends Component {
  /** Applies the model's position and heading (GameRoot calls it every frame). */
  render(model: TractorModel): void {
    this.node.setPosition(model.x, 0, model.z);
    this.node.setRotationFromEuler(0, model.yaw * RAD_TO_DEG, 0);
  }
}
