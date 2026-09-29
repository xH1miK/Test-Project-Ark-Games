import { _decorator, Camera, Component, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { Config } from '../core/Config';
import type { CoinFlights } from '../economy/CoinFlights';
import { coinPose } from '../fx/CoinArc';
import type { CoinPose } from '../fx/CoinArc';

const { ccclass, property } = _decorator;

/** A source of flying coins and which way they go: to the counter (from a world point) or from it (to a world point). */
export interface CoinRoute {
  readonly flights: CoinFlights;
  readonly toHud: boolean;
}

/** Width of a pooled coin node in UI units; the real size comes from the node's scale. */
const BASE = 100;

const tmpWorld = new Vec3();
const tmpA = new Vec3();
const tmpB = new Vec3();
const pose: CoinPose = { x: 0, y: 0, rot: 0, size: 0 };

/**
 * Draws the coins in the air as sprites on the screen: from the shredder to the coin counter, and from
 * the counter to a pay pad. The flights (CoinFlights, pure) say where each coin is in its flight; this
 * projects the world end of the path through the main camera into the HUD's UI space, takes the other
 * end from the counter's icon and places one pooled sprite per coin along the arc (CoinArc). It lives
 * in the HUD group above the counter, so the coins are drawn over it and, like all the screen UI,
 * over the world, in the UI's one batch: no extra draw calls. GameRoot binds it and renders it after
 * the camera has moved.
 */
@ccclass('CoinFlightView')
export class CoinFlightView extends Component {
  @property({ type: Camera, tooltip: 'The world camera the coins\' world end is projected through.' })
  camera: Camera | null = null;

  @property({ type: SpriteFrame, tooltip: 'The coin sprite.' })
  coin: SpriteFrame | null = null;

  private routes: readonly CoinRoute[] = [];
  private icon: Node | null = null;
  private readonly nodes: Node[] = [];
  /** How many pooled nodes were shown last frame (the rest are hidden already). */
  private shown = 0;

  /** Coin nodes visible right now (QA checks read it). */
  get visible(): number {
    return this.shown;
  }

  /** Where the coins go to / come from: the counter's icon; and the flights to draw. */
  bind(icon: Node, routes: readonly CoinRoute[]): void {
    this.icon = icon;
    this.routes = routes;
    let total = 0;
    for (const r of routes) total += r.flights.coins.length;
    while (this.nodes.length < total) this.nodes.push(this.makeNode());
  }

  /** Puts a sprite on every coin in the air; hides the spare ones. */
  render(): void {
    const camera = this.camera;
    const icon = this.icon;
    if (!camera || !icon) return;
    icon.getWorldPosition(tmpWorld);
    // The counter's icon in this node's space.
    this.node.inverseTransformPoint(tmpB, tmpWorld);
    let used = 0;
    for (const route of this.routes) {
      const flights = route.flights;
      for (let k = 0; k < flights.count; k++) {
        const coin = flights.coins[k];
        tmpWorld.set(coin.x, coin.y, coin.z);
        camera.convertToUINode(tmpWorld, this.node, tmpA);
        const t = coin.time / coin.duration;
        if (route.toHud) coinPose(pose, Config.coinFx.sprite, t, coin.lane, tmpA.x, tmpA.y, tmpB.x, tmpB.y);
        else coinPose(pose, Config.coinFx.sprite, t, coin.lane, tmpB.x, tmpB.y, tmpA.x, tmpA.y);
        const node = this.nodes[used++];
        if (!node.active) node.active = true;
        node.setPosition(pose.x, pose.y, 0);
        node.setRotationFromEuler(0, 0, pose.rot);
        const s = pose.size / BASE;
        node.setScale(s, s, 1);
      }
    }
    for (let k = used; k < this.shown; k++) this.nodes[k].active = false;
    this.shown = used;
  }

  private makeNode(): Node {
    const node = new Node(`Coin${this.nodes.length}`);
    node.layer = this.node.layer;
    const ui = node.addComponent(UITransform);
    ui.setContentSize(BASE, BASE);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = this.coin;
    node.active = false;
    node.setParent(this.node);
    return node;
  }
}
