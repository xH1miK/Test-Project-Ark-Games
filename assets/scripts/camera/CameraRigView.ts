import { _decorator, Component } from 'cc';
import type { CameraRigModel } from './CameraRigModel';

const { ccclass } = _decorator;

/** The follow camera in the scene: puts this camera node at the model's pose. */
@ccclass('CameraRigView')
export class CameraRigView extends Component {
  /** Applies the model's position and angles (GameRoot calls it every frame). */
  render(model: CameraRigModel): void {
    const p = model.position;
    this.node.setPosition(p.x, p.y, p.z);
    this.node.setRotationFromEuler(model.pitch, model.yaw, 0);
  }
}
