import { _decorator, Component, Node, Vec3 } from 'cc';
import { Config } from './Config';
import { EventBus } from './Events';
import type { GameEvents } from './Events';
import { exposeForQa } from './QaBridge';
import { CameraRigModel } from '../camera/CameraRigModel';
import { CameraRigView } from '../camera/CameraRigView';
import { JoystickModel } from '../input/JoystickModel';
import { JoystickView } from '../input/JoystickView';
import { MoveInput } from '../input/MoveInput';
import { TractorModel } from '../tractor/TractorModel';
import { TractorView } from '../tractor/TractorView';
import type { ObstacleGrid } from '../world/ObstacleGrid';
import { buildObstacleGrid } from '../world/StaticBlocker';

const { ccclass, property } = _decorator;

const tmpForward = new Vec3();

/**
 * Composition root: creates the models, wires them to the scene's views and drives the frame in a
 * fixed order (update: input -> tractor; lateUpdate: views and camera). The only place that knows
 * every system (Unity analogy: a bootstrap MonoBehaviour).
 */
@ccclass('GameRoot')
export class GameRoot extends Component {
  @property({ type: Node, tooltip: 'Root of the static level; every StaticBlocker below it becomes collision.' })
  level: Node | null = null;

  @property({ type: Node, tooltip: 'Where the tractor starts; its +Z is the start heading.' })
  startSpot: Node | null = null;

  @property({ type: TractorView })
  tractorView: TractorView | null = null;

  @property({ type: CameraRigView })
  cameraView: CameraRigView | null = null;

  @property({ type: JoystickView })
  joystickView: JoystickView | null = null;

  readonly events = new EventBus<GameEvents>();
  private obstacles!: ObstacleGrid;
  private joystick!: JoystickModel;
  private moveInput!: MoveInput;
  private tractor!: TractorModel;
  private camera!: CameraRigModel;

  protected onLoad(): void {
    const { level, startSpot, tractorView, cameraView, joystickView } = this;
    if (!level || !startSpot || !tractorView || !cameraView || !joystickView) {
      throw new Error('GameRoot: level, startSpot, tractorView, cameraView and joystickView must be assigned');
    }
    this.obstacles = buildObstacleGrid(level, Config.world.bounds, Config.world.cellSize);

    this.joystick = new JoystickModel(Config.joystick);
    this.moveInput = new MoveInput();

    this.tractor = new TractorModel(Config.tractor, Config.tractor.tiers[0], this.obstacles);
    Vec3.transformQuat(tmpForward, Vec3.UNIT_Z, startSpot.worldRotation);
    this.tractor.place(startSpot.worldPosition.x, startSpot.worldPosition.z, Math.atan2(tmpForward.x, tmpForward.z));

    this.camera = new CameraRigModel(Config.camera);
    this.camera.snap(this.tractor.x, 0, this.tractor.z);
    this.events.on('tierChanged', ({ tier }) =>
      this.camera.zoomTo(Math.pow(Config.camera.tierZoom, tier - 1), Config.camera.zoomTime));

    joystickView.bind(this.joystick);
    tractorView.render(this.tractor);
    cameraView.render(this.camera);

    exposeForQa({
      obstacles: this.obstacles,
      events: this.events,
      joystick: this.joystick,
      input: this.moveInput,
      tractor: this.tractor,
      camera: this.camera,
    });
  }

  protected update(dt: number): void {
    const step = Math.min(dt, Config.time.maxFrameDt);
    this.joystick.update(step);
    this.moveInput.setFromStick(this.joystick.stick.x, this.joystick.stick.y, this.camera.yaw);
    this.tractor.update(step, this.moveInput.x, this.moveInput.z);
  }

  protected lateUpdate(dt: number): void {
    const step = Math.min(dt, Config.time.maxFrameDt);
    this.tractorView!.render(this.tractor);
    this.camera.update(step, this.tractor.x, 0, this.tractor.z);
    this.cameraView!.render(this.camera);
    this.joystickView!.render();
  }
}
