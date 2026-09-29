import { _decorator, Camera, Component, Node, Vec3, screen } from 'cc';
import { Config } from './Config';
import { EventBus } from './Events';
import type { GameEvents } from './Events';
import { exposeForQa, qaFlag } from './QaBridge';
import { AudioManager } from '../audio/AudioManager';
import { SoundPresenter } from '../audio/SoundPresenter';
import { SoundView } from '../audio/SoundView';
import { layCarpet, mulberry32 } from '../balls/BallCarpet';
import type { CarpetHole } from '../balls/BallCarpet';
import { BallField } from '../balls/BallField';
import { BallRenderer } from '../balls/BallRenderer';
import { CameraRigModel } from '../camera/CameraRigModel';
import { CameraRigView } from '../camera/CameraRigView';
import { CoinFlights } from '../economy/CoinFlights';
import { PuffRenderer } from '../fx/PuffRenderer';
import { Puffs } from '../fx/Puffs';
import { PayPad } from '../economy/PayPad';
import { PayPadView } from '../economy/PayPadView';
import { Progression } from '../economy/Progression';
import { Purse } from '../economy/Purse';
import { Shredder } from '../economy/Shredder';
import { ShredderView } from '../economy/ShredderView';
import { JoystickModel } from '../input/JoystickModel';
import { JoystickView } from '../input/JoystickView';
import { MoveInput } from '../input/MoveInput';
import { Bucket } from '../tractor/Bucket';
import { TractorModel } from '../tractor/TractorModel';
import { TractorView } from '../tractor/TractorView';
import { TutorialFlow } from '../tutorial/TutorialFlow';
import { TutorialMarkers } from '../tutorial/TutorialMarkers';
import { TutorialView } from '../tutorial/TutorialView';
import { CoinFlightView } from '../ui/CoinFlightView';
import { CoinHud } from '../ui/CoinHud';
import { FinaleView } from '../ui/FinaleView';
import { Gate } from '../world/Gate';
import { GateView } from '../world/GateView';
import type { ObstacleGrid } from '../world/ObstacleGrid';
import { buildObstacleGrid } from '../world/StaticBlocker';

const { ccclass, property } = _decorator;

const tmpForward = new Vec3();

/** Heading about +Y of a node (Cocos convention: local +Z points to (sin yaw, cos yaw)). */
function yawOf(node: Node): number {
  Vec3.transformQuat(tmpForward, Vec3.UNIT_Z, node.worldRotation);
  return Math.atan2(tmpForward.x, tmpForward.z);
}

/**
 * Composition root: creates the models, wires them to the scene's views and drives the frame in a
 * fixed order (update: input, then tractor -> scoop -> balls -> carry -> shredder in steps of at most
 * Config.time.maxStep, then the coins in the air, then the gate, then the pay pads; sound rules run first; lateUpdate: views
 * and camera).
 * The only place that knows every system (Unity analogy: a bootstrap MonoBehaviour).
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

  @property({ type: ShredderView, tooltip: 'On the shredder node: the shredder stands where that node is.' })
  shredderView: ShredderView | null = null;

  @property({ type: CoinHud })
  coinHud: CoinHud | null = null;

  @property({ type: PayPadView, tooltip: 'On the upgrade pad spot: the pad stands where that node is.' })
  upgradePadView: PayPadView | null = null;

  @property({ type: PayPadView, tooltip: 'On the gate pad spot: the pad stands where that node is.' })
  gatePadView: PayPadView | null = null;

  @property({ type: CoinFlightView, tooltip: 'Draws the coins in the air (under Canvas/Hud, after the coin counter).' })
  coinFlightView: CoinFlightView | null = null;

  @property({ type: PuffRenderer, tooltip: 'On an empty node at the origin: draws the dust and sparks.' })
  puffRenderer: PuffRenderer | null = null;

  @property({ type: PayPadView, tooltip: 'The price sign over the gate (shows the gate pad).' })
  gateSignView: PayPadView | null = null;

  @property({ type: GateView, tooltip: 'The force-field curtain in the gateway.' })
  gateView: GateView | null = null;

  @property({ type: FinaleView, tooltip: 'The title and the confetti of the end (under Canvas/Hud).' })
  finaleView: FinaleView | null = null;

  @property({ type: TutorialView, tooltip: 'On an empty node at the origin: draws the tutorial arrow and pointer.' })
  tutorialView: TutorialView | null = null;

  @property({ type: SoundView, tooltip: 'Plays the sounds (holds the clips of assets/audio).' })
  soundView: SoundView | null = null;

  readonly events = new EventBus<GameEvents>();
  private obstacles!: ObstacleGrid;
  private joystick!: JoystickModel;
  private moveInput!: MoveInput;
  private tractor!: TractorModel;
  private balls!: BallField;
  private bucket!: Bucket;
  private shredder!: Shredder;
  private purse!: Purse;
  private coins!: CoinFlights;
  private progression!: Progression;
  private gate!: Gate;
  private tutorial!: TutorialFlow;
  private markers!: TutorialMarkers;
  private camera!: CameraRigModel;
  private puffs!: Puffs;
  private sound!: AudioManager;
  private soundPresenter!: SoundPresenter;
  private worldCamera!: Camera;
  private upgradePadSeen = false;

  protected onLoad(): void {
    const { level, startSpot, tractorView, cameraView, joystickView, ballView, shredderView, coinHud, upgradePadView, gatePadView, gateSignView,
      gateView, finaleView, tutorialView, coinFlightView, puffRenderer, soundView } = this;
    if (!level || !startSpot || !tractorView || !cameraView || !joystickView || !ballView || !shredderView || !coinHud
      || !upgradePadView || !gatePadView || !gateSignView || !gateView || !finaleView || !tutorialView || !coinFlightView || !puffRenderer || !soundView) {
      throw new Error('GameRoot: level, startSpot, the views (tractor, camera, joystick, balls, shredder, coin HUD, pads, gate sign, gate curtain, finale, tutorial, coin flights, puffs, sound) must be assigned');
    }
    this.obstacles = buildObstacleGrid(level, Config.world.bounds, Config.world.cellSize);

    this.joystick = new JoystickModel(Config.joystick);
    this.moveInput = new MoveInput();

    this.tractor = new TractorModel(Config.tractor, Config.tractor.tiers, this.obstacles, this.events);
    this.tractor.place(startSpot.worldPosition.x, startSpot.worldPosition.z, yawOf(startSpot));

    // Pad plates on the ground; the gate's is there from the start, so the carpet leaves it bare (ball
    // centres up to the edge of its clear zone: a carpet hole keeps them a radius off its own edge).
    const upgradePlate = upgradePadView.plateRect(Config.pads.clearMargin);
    const gatePlate = gatePadView.plateRect(Config.pads.clearMargin);
    const { radius, maxCount, carpet } = Config.balls;
    const holes: CarpetHole[] = [...carpet.holes];
    if (gatePlate) {
      holes.push({ kind: 'box', x: (gatePlate.minX + gatePlate.maxX) / 2, z: (gatePlate.minZ + gatePlate.maxZ) / 2,
        halfX: (gatePlate.maxX - gatePlate.minX) / 2 - radius, halfZ: (gatePlate.maxZ - gatePlate.minZ) / 2 - radius });
    }
    const centres = layCarpet({ ...carpet, holes }, radius, maxCount, this.obstacles);
    this.balls = new BallField(Config.balls, centres.length / 2, this.obstacles);
    for (let k = 0; k < centres.length; k += 2) this.balls.add(centres[k], radius, centres[k + 1]);
    const slots = Math.max(...Config.tractor.tiers.map((t) => t.bucketCapacity));
    const pile = { ...Config.bucket, radius, gravity: Config.balls.gravity };
    this.bucket = new Bucket(pile, this.balls, this.tractor, slots, this.events);

    const at = shredderView.node.worldPosition;
    const pose = { x: at.x, y: at.y, z: at.z, yaw: yawOf(shredderView.node) };
    this.shredder = new Shredder({ ...Config.shredder, coinsPerBall: Config.economy.coinsPerBall }, pose, this.balls, this.bucket, this.tractor, this.events);
    this.purse = new Purse(this.events);
    this.coins = new CoinFlights(Config.coinFx, this.purse);
    this.events.on('coinsEarned', ({ amount, x, y, z }) => this.coins.launch(amount, x, y, z));
    this.events.on('purseChanged', ({ total }) => coinHud.show(total));

    const { upgradePrice, gatePrice } = Config.economy;
    const upgradePad = new PayPad('upgrade', Config.pads, upgradePadView.node.worldPosition, upgradePrice, this.purse, this.tractor,
      Config.coinFx, this.events, { shown: false, plate: upgradePlate });
    const gatePad = new PayPad('gate', Config.pads, gatePadView.node.worldPosition, gatePrice, this.purse, this.tractor,
      Config.coinFx, this.events, { shown: true, plate: gatePlate });
    this.balls.addClearZone(upgradePad.clearZone);
    this.balls.addClearZone(gatePad.clearZone);
    // Paying the gate ends the run: the controls go off (the drive command and the joystick), the gate opens.
    this.gate = new Gate('gate', Config.gate, this.events);
    const controls = { lock: () => { this.moveInput.lock(); this.joystick.disable(); } };
    this.progression = new Progression(Config.pads, upgradePad, gatePad,
      { ground: this.balls, machine: this.tractor, controls, gate: this.gate }, this.events);
    this.events.on('gateOpening', () => finaleView.play());

    // The tutorial (no intro to wait for: it starts with the run) reads the pads, the purse, the tier and the gate.
    this.tutorial = new TutorialFlow({ purse: this.purse, shredder: pose, upgradePad, gatePad, machine: this.tractor, gate: this.gate });
    this.markers = new TutorialMarkers(Config.tutorial);
    this.tutorial.begin();

    // Dust and sparks: the balls landing in the shredder, the upgrade, the upgrade pad popping up, the gate opening.
    this.puffs = new Puffs(Config.puffs);
    const { recipes } = Config.puffs;
    this.events.on('ballsShredded', ({ count }) =>
      this.puffs.emit(recipes.landing, pose.x, pose.y + Config.shredder.handIn.aimHeight, pose.z, Math.min(recipes.landing.count, Math.ceil(count / 4))));
    this.events.on('tierChanged', ({ tier }) => { if (tier > 1) this.puffs.emit(recipes.upgrade, this.tractor.x, 0, this.tractor.z); });
    this.events.on('gateOpening', () => {
      const at = gateView.node.worldPosition;
      this.camera.peek(at.x, at.z, Config.camera.peekGate);
      this.puffs.emit(recipes.gate, at.x, at.y + recipes.gate.box[1], at.z + 0.2);
    });
    this.worldCamera = cameraView.getComponent(Camera)!;
    puffRenderer.bind(this.puffs);

    // Sound: the rules (AudioManager) decide, SoundView plays; the presenter turns game events into sounds. The first
    // real gesture of the page unlocks the browser's audio.
    this.sound = new AudioManager(Config.sound, soundView, mulberry32(Config.sound.seed));
    soundView.listenForGestures(() => this.sound.gesture());
    this.soundPresenter = new SoundPresenter(this.events, this.sound, { tractor: this.tractor, shredder: this.shredder },
      { engineMinSpeed: Config.sound.engineMinSpeed, prices: { upgrade: upgradePrice, gate: gatePrice } });
    this.soundPresenter.start();

    this.camera = new CameraRigModel(Config.camera);
    this.camera.setAspect(screen.windowSize.width / screen.windowSize.height);
    this.camera.snap(this.tractor.x, 0, this.tractor.z);
    if (!qaFlag('nopeek')) this.camera.peek(pose.x, pose.z, Config.camera.peekStart);
    this.events.on('tierChanged', ({ tier }) =>
      this.camera.zoomTo(Math.pow(Config.camera.tierZoom, tier - 1), Config.camera.zoomTime));

    coinFlightView.bind(coinHud.icon!, [
      { flights: this.coins, toHud: true },
      { flights: upgradePad.flights, toHud: false },
      { flights: gatePad.flights, toHud: false },
    ]);
    joystickView.bind(this.joystick);
    tractorView.render(this.tractor);
    cameraView.render(this.camera);
    ballView.bind(this.balls, radius, Config.balls.look, Config.balls.bounds);
    shredderView.render(this.shredder);
    coinHud.show(this.purse.total, false);
    this.renderPads();
    gateView.render(this.gate, 0);

    exposeForQa({
      config: Config,
      obstacles: this.obstacles,
      events: this.events,
      joystick: this.joystick,
      input: this.moveInput,
      tractor: this.tractor,
      balls: this.balls,
      bucket: this.bucket,
      shredder: this.shredder,
      purse: this.purse,
      coins: this.coins,
      progression: this.progression,
      pads: { upgrade: upgradePad, gate: gatePad },
      gate: this.gate,
      gateView,
      finaleView,
      tutorial: this.tutorial,
      markers: this.markers,
      tutorialView,
      ballView,
      coinHud,
      coinFlightView,
      puffs: this.puffs,
      puffRenderer,
      sound: this.sound,
      soundView,
      tractorView,
      camera: this.camera,
    });
  }

  protected update(dt: number): void {
    const frame = Math.min(dt, Config.time.maxFrameDt);
    if (frame <= 0) return;
    // Sound first: the loops follow last frame's world, this frame's events then play under this frame's caps.
    this.soundPresenter.update();
    this.sound.update(frame);
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
      // In its zone the shredder takes the load as carried this step; it also swallows its throat.
      this.shredder.step(step);
    }
    this.coins.update(frame);
    this.puffs.update(frame);
    // The gate before the pads: a gate opened by this frame's payment starts counting next frame.
    this.gate.step(frame);
    // Pads take from the purse after this frame's coins have arrived in it.
    this.progression.step(frame);
    // The tutorial last: it reads what this frame's payments did (a gate paid now is Done now).
    this.tutorial.update();
  }

  protected lateUpdate(dt: number): void {
    const step = Math.min(dt, Config.time.maxFrameDt);
    this.tractorView!.render(this.tractor);
    const { width, height } = screen.windowSize;
    this.camera.setAspect(width / height);
    this.camera.update(step, this.tractor.x, 0, this.tractor.z);
    this.cameraView!.render(this.camera);
    this.coinFlightView!.render();
    this.markers.update(step, this.tractor.x, this.tractor.z, this.tutorial.target);
    this.tutorialView!.render(this.markers);
    this.joystickView!.render();
    this.ballView!.render(this.balls, this.bucket);
    this.shredderView!.render(this.shredder);
    this.renderPads();
    const upgradePad = this.progression.upgradePad;
    if (upgradePad.shown && !this.upgradePadSeen) this.camera.peek(upgradePad.x, upgradePad.z, Config.camera.peekPad);
    if (upgradePad.shown && !this.upgradePadSeen) this.puffs.emit(Config.puffs.recipes.padPop, upgradePad.x, 0, upgradePad.z);
    this.upgradePadSeen = upgradePad.shown;
    this.puffRenderer!.render(this.worldCamera);
    this.gateView!.render(this.gate, step);
    // The ball view has redrawn this frame's moved (flying, removed) and carried balls.
    this.balls.clearMoved();
    this.bucket.clearMoved();
  }

  private renderPads(): void {
    const { upgradePad, gatePad } = this.progression;
    this.upgradePadView!.render(upgradePad);
    this.gatePadView!.render(gatePad);
    this.gateSignView!.render(gatePad);
  }
}
