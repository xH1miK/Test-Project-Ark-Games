import { _decorator, Component, Label, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import { Config } from '../core/Config';
import type { GroundRect, PayPad } from './PayPad';

const { ccclass, property } = _decorator;

const tmpCorner = new Vec3();
const tmpWorld = new Vec3();

/**
 * Shows a pay pad's price: a plate lying on the ground or a sign standing over the gate (a RenderRoot2D
 * with a sprite and a bitmap-font counter, drawn by the main camera). The counter reads what is still
 * owed, then `doneText` once the pad is bought. The visual pops up when the pad appears and shrinks
 * away when it goes. Several views may show one pad (the gate: its plate and the sign).
 */
@ccclass('PayPadView')
export class PayPadView extends Component {
  @property({ type: Node, tooltip: 'What pops up and shrinks away: the RenderRoot2D of the plate or the sign.' })
  visual: Node | null = null;

  @property({ type: Label, tooltip: 'The price still owed (bitmap font: it changes every frame while paying).' })
  amount: Label | null = null;

  @property({ type: UITransform, tooltip: 'The plate lying on the ground; balls are kept off it while the pad takes coins. Empty for a sign.' })
  plate: UITransform | null = null;

  @property({ tooltip: 'What the counter reads once there is nothing more to buy here.' })
  doneText = 'MAX';

  private readonly restScale = new Vec3(1, 1, 1);
  private readonly tinyScale = new Vec3();
  private shown: boolean | null = null;
  private text = '';

  protected onLoad(): void {
    if (this.visual) {
      this.restScale.set(this.visual.scale);
      Vec3.multiplyScalar(this.tinyScale, this.restScale, 0.01);
    }
  }

  /** The plate's rectangle on the ground (world XZ), grown by `margin` on every side; null without a plate. */
  plateRect(margin: number): GroundRect | null {
    const ui = this.plate;
    if (!ui) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const { width, height, anchorX, anchorY } = ui;
    for (let k = 0; k < 4; k++) {
      tmpCorner.set((k & 1 ? 1 - anchorX : -anchorX) * width, (k & 2 ? 1 - anchorY : -anchorY) * height, 0);
      ui.convertToWorldSpaceAR(tmpCorner, tmpWorld);
      minX = Math.min(minX, tmpWorld.x);
      maxX = Math.max(maxX, tmpWorld.x);
      minZ = Math.min(minZ, tmpWorld.z);
      maxZ = Math.max(maxZ, tmpWorld.z);
    }
    return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
  }

  /** Applies the pad's state (GameRoot calls it every frame). */
  render(pad: PayPad): void {
    this.showVisual(pad.shown);
    const text = pad.closed ? this.doneText : String(pad.owed);
    if (text !== this.text && this.amount) {
      this.text = text;
      this.amount.string = text;
    }
  }

  private showVisual(shown: boolean): void {
    const visual = this.visual;
    if (!visual || shown === this.shown) return;
    const first = this.shown === null;
    this.shown = shown;
    Tween.stopAllByTarget(visual); // tween(visual).stop() would stop only a new, empty tween
    if (first) {
      // The state the run starts in: no animation.
      visual.active = shown;
      visual.setScale(this.restScale);
      return;
    }
    const { popTime, shrinkTime } = Config.pads;
    if (shown) {
      visual.active = true;
      visual.setScale(this.tinyScale);
      tween(visual).to(popTime, { scale: this.restScale }, { easing: 'backOut' }).start();
    } else {
      tween(visual)
        .to(shrinkTime, { scale: this.tinyScale }, { easing: 'backIn' })
        .call(() => {
          visual.active = false;
        })
        .start();
    }
  }
}
