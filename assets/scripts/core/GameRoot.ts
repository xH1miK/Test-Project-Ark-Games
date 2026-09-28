import { _decorator, Component, Node, Vec3 } from 'cc';
import { Config } from './Config';
import { EventBus } from './Events';
import type { GameEvents } from './Events';
import { exposeForQa } from './QaBridge';
import { layCarpet } from '../balls/BallCarpet';
import { BallField } from '../balls/BallField';
import { BallRenderer } from '../balls/BallRenderer';
import { CameraRigModel } from '../camera/CameraRigModel';
import { CameraRigView } from '../camera/CameraRigView';
import { JoystickModel } from '../input/JoystickModel';
import { JoystickView } from '../input/JoystickView';
import { MoveInput } from '../input/MoveInput';
import { Bucket } from '../tractor/Bucket';
import { TractorModel } from '../tractor/TractorModel';
import { TractorView } from '../tractor/TractorView';
import type { ObstacleGrid } from '../world/ObstacleGrid';
import { buildObstacleGrid } from '../world/StaticBlocker';

const { ccclass, property } = _decorator;

const tmpForward = new Vec3();

/**
 * Composition root: creates the models, wires them to the scene's views and drives the frame in a
 * fixed order (update: input, then tractor -> scoop -> balls -> carry in steps of at most
 * Config.time.maxStep; lateUpdate: views and camera). The only place that knows every system
 * (Unity analogy: a bootstrap MonoBehaviour).
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

  @property({ type: BallRenderer })
  ballView: BallRenderer | null = null;

  readonly events = new EventBus<GameEvents>();
  private obstacles!: ObstacleGrid;
  private joystick!: JoystickModel;
  private moveInput!: MoveInput;
  private tractor!: TractorModel;
  private balls!: BallField;
  private bucket!: Bucket;
  private camera!: CameraRigModel;

  protected onLoad(): void {
    const { level, startSpot, tractorView, cameraView, joystickView, ballView } = this;
    if (!level || !startSpot || !tractorView || !cameraView || !joystickView || !ballView) {
      throw new Error('GameRoot: level, startSpot, tractorView, cameraView, joystickView and ballView must be assigned');
    }
    this.obstacles = buildObstacleGrid(level, Config.world.bounds, Config.world.cellSize);

    this.joystick = new JoystickModel(Config.joystick);
    this.moveInput = new MoveInput();

    this.tractor = new TractorModel(Config.tractor, Config.tractor.tiers[0], this.obstacles);
    Vec3.transformQuat(tmpForward, Vec3.UNIT_Z, startSpot.worldRotation);
    this.tractor.place(startSpot.worldPosition.x, startSpot.worldPosition.z, Math.atan2(tmpForward.x, tmpForward.z));

    const { radius, maxCount, carpet } = Config.balls;
    const centres = layCarpet(carpet, radius, maxCount, this.obstacles);
    this.balls = new BallField(Config.balls, centres.length / 2, this.obstacles);
    for (let k = 0; k < centres.length; k += 2) this.balls.add(centres[k], radius, centres[k + 1]);
    const slots = Math.max(...Config.tractor.tiers.map((t) => t.bucketCapacity));
    const pile = { ...Config.bucket, radius, gravity: Config.balls.gravity };
    this.bucket = new Bucket(pile, this.balls, this.tractor, slots, this.events);

    this.camera = new CameraRigModel(Config.camera);
    this.camera.snap(this.tractor.x, 0, this.tractor.z);
    this.events.on('tierChanged', ({ tier }) =>
      this.camera.zoomTo(Math.pow(Config.camera.tierZoom, tier - 1), Config.camera.zoomTime));

    joystickView.bind(this.joystick);
    tractorView.render(this.tractor);
    cameraView.render(this.camera);
    ballView.bind(this.balls, radius, Config.balls.look, Config.balls.bounds);

    exposeForQa({
      config: Config,
      obstacles: this.obstacles,
      events: this.events,
      joystick: this.joystick,
      input: this.moveInput,
      tractor: this.tractor,
      balls: this.balls,
      bucket: this.bucket,
      ballView,
      camera: this.camera,
    });
  }

  protected update(dt: number): void {
    const frame = Math.min(dt, Config.time.maxFrameDt);
    if (frame <= 0) return;
    this.joystick.update(frame);
    this.moveInput.setFromStick(this.joystick.stick.x, this.joystick.stick.y, this.camera.yaw);
    // A slow frame runs in several short steps: the balls must see the tractor move a little at a time.
    const steps = Math.ceil(frame / Config.time.maxStep - 1e-9);
    const step = frame / steps;
    for (let i = 0; i < steps; i++) {
      this.tractor.update(step, this.moveInput.x, this.moveInput.z);
      // The bucket takes what is in its mouth before the balls move (and before its box could shove them).
      this.bucket.scoop();
      this.balls.step(step, this.tractor);
      this.bucket.carry(step);
    }
  }

  protected lateUpdate(dt: number): void {
    const step = Math.min(dt, Config.time.maxFrameDt);
    this.tractorView!.render(this.tractor);
    this.camera.update(step, this.tractor.x, 0, this.tractor.z);
    this.cameraView!.render(this.camera);
    this.joystickView!.render();
    this.ballView!.render(this.balls, this.bucket);
    // The ball view has redrawn this frame's moved and carried balls.
    this.balls.clearMoved();
    this.bucket.clearMoved();
  }
}
