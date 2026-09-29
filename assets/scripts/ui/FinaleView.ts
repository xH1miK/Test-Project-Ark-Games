import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame, Tween, tween, UITransform, Vec3 } from 'cc';
import { Config } from '../core/Config';
import { Confetti, PieceState } from '../fx/Confetti';

const { ccclass, property } = _decorator;

const tmpTiny = new Vec3(0.01, 0.01, 1);
const tmpOne = new Vec3(1, 1, 1);
const tmpBig = new Vec3();
/**
 * The end of the run on the screen: the title "GATE OPEN!" pops up with a spring and then pulses, and
 * confetti fires from the bottom corners and rains from the top. Lives in the HUD group (`Canvas/Hud`),
 * so it draws on top of the world like every screen UI; the title is a bitmap-font Label and the
 * pieces are sprites of one small texture, so the whole show stays in the UI's one batch. The model of
 * the pieces is Confetti (pure); this only draws it. GameRoot calls play() when the gate starts to open.
 */
@ccclass('FinaleView')
export class FinaleView extends Component {
  @property({ type: Label, tooltip: 'The title (bitmap font); inactive until the finale.' })
  title: Label | null = null;

  @property({ type: SpriteFrame, tooltip: 'One confetti piece (white; tinted per piece).' })
  piece: SpriteFrame | null = null;

  @property({ type: Node, tooltip: 'Parent of the pooled confetti pieces (an empty child of this node).' })
  pieces: Node | null = null;

  private readonly confetti = new Confetti(Config.finale.confetti);
  private readonly colors: Color[] = Config.finale.confetti.colors.map((hex) => new Color().fromHEX(hex));
  private readonly nodes: Node[] = [];
  private readonly sprites: Sprite[] = [];
  private readonly alphas = new Uint8Array(Config.finale.confetti.count).fill(255);
  private started = false;

  /** True from play() on (the title stays up: the run is over). */
  get playing(): boolean {
    return this.started;
  }

  /** The confetti model, for QA checks. */
  get show(): Confetti {
    return this.confetti;
  }

  play(): void {
    if (this.started) return;
    this.started = true;
    const size = this.screen();
    this.confetti.burst(size.width, size.height);
    this.buildPieces();
    const title = this.title;
    if (title) {
      const { pop, pulseScale, pulsePeriod } = Config.finale.title;
      const node = title.node;
      node.active = true;
      node.setScale(tmpTiny);
      this.placeTitle(size.height);
      Tween.stopAllByTarget(node);
      Vec3.set(tmpBig, pulseScale, pulseScale, 1);
      const big = tmpBig.clone();
      const one = tmpOne.clone();
      tween(node)
        .to(pop, { scale: one }, { easing: 'backOut' })
        .call(() => {
          tween(node)
            .to(pulsePeriod / 2, { scale: big }, { easing: 'sineInOut' })
            .to(pulsePeriod / 2, { scale: one }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
        })
        .start();
    }
  }

  protected onDisable(): void {
    if (this.title) Tween.stopAllByTarget(this.title.node);
  }

  protected update(dt: number): void {
    if (!this.started) return;
    const size = this.screen();
    this.placeTitle(size.height);
    const c = this.confetti;
    c.update(dt);
    for (let i = 0; i < c.count; i++) {
      const node = this.nodes[i];
      if (!node) break;
      const flying = c.state[i] === PieceState.Flying;
      if (node.active !== flying) node.active = flying;
      if (!flying) continue;
      node.setPosition(c.x[i], c.y[i], 0);
      node.setRotationFromEuler(0, 0, c.rot[i]);
      node.setScale(c.size[i] * Math.max(0.08, c.flip[i]), c.size[i], 1);
      const a = Math.round(c.alpha(i) * 255);
      if (a !== this.alphas[i]) {
        this.alphas[i] = a;
        const color = this.colors[c.color[i]];
        this.sprites[i].color = tmpColor.set(color.r, color.g, color.b, a);
      }
    }
  }

  /** The screen in UI units: what the HUD group covers. */
  private screen(): { width: number; height: number } {
    const ui = this.node.parent?.getComponent(UITransform);
    return ui ? { width: ui.width, height: ui.height } : { width: Config.ui.designWidth, height: Config.ui.designHeight };
  }

  private placeTitle(height: number): void {
    this.title?.node.setPosition(0, height * Config.finale.title.height, 0);
  }

  /** The pool of piece nodes, made once at the first play(): a node per piece, hidden until it flies. */
  private buildPieces(): void {
    const parent = this.pieces;
    if (!parent || !this.piece || this.nodes.length > 0) return;
    for (let i = 0; i < this.confetti.count; i++) {
      const node = new Node(`Piece${i}`);
      node.layer = parent.layer;
      const ui = node.addComponent(UITransform);
      ui.setContentSize(32, 20);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = this.piece;
      const color = this.colors[this.confetti.color[i]];
      sprite.color = tmpColor.set(color.r, color.g, color.b, 255);
      node.active = false;
      node.setParent(parent);
      this.nodes.push(node);
      this.sprites.push(sprite);
    }
  }
}

const tmpColor = new Color();
