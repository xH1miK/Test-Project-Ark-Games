import { _decorator, Color, Component, Sprite, UITransform } from 'cc';
import type { Gate } from './Gate';

const { ccclass, property } = _decorator;

/**
 * The force-field curtain that seals the gateway until the gate is paid, and its opening: a sheet
 * sprite that holds, then folds up into the lintel (scale Y down, bottom edge rising) while it fades,
 * and a sprite of sparks that flashes and drifts up meanwhile. Both are sprites of one world-space
 * RenderRoot2D on the WorldSprite material (drawn by the main camera, depth-tested: 1 draw call), both
 * anchored bottom-centre on the gateway's floor. Put it on the RenderRoot2D node; the model is the Gate.
 */
@ccclass('GateView')
export class GateView extends Component {
  @property({ type: Sprite, tooltip: 'The curtain sheet, anchored at the bottom centre of the gateway.' })
  sheet: Sprite | null = null;

  @property({ type: Sprite, tooltip: 'The sparks, the same size and anchor as the sheet.' })
  sparks: Sprite | null = null;

  @property({ tooltip: 'Share of the sheet height the sparks drift up over the opening.' })
  sparkRise = 0.55;

  private readonly color = new Color(255, 255, 255, 255);
  private clock = 0;
  private sheetAlpha = -1;
  private sparkAlpha = -1;
  private sparksOn: boolean | null = null;

  /** Applies the gate's state (GameRoot calls it every frame; `dt` only times the curtain's shimmer). */
  render(gate: Gate, dt: number): void {
    const { sheet, sparks } = this;
    const ui = sheet?.getComponent(UITransform);
    if (!sheet || !sparks || !ui) return;
    if (gate.phase === 'open') {
      if (this.node.active) this.node.active = false;
      return;
    }
    this.clock += dt;
    const shimmer = 0.95 + 0.05 * Math.sin(2 * this.clock);
    if (gate.phase === 'closed') {
      this.setSparks(false);
      this.setSheetAlpha(shimmer);
      return;
    }
    const fold = gate.fold;
    sheet.node.setScale(1, Math.max(0.001, 1 - fold), 1);
    sheet.node.setPosition(0, ui.height * fold, 0);
    this.setSheetAlpha((1 - fold) * shimmer);
    this.setSparks(true);
    sparks.node.setPosition(0, ui.height * gate.progress * this.sparkRise, 0);
    this.setSparkAlpha(gate.flash);
  }

  private setSparks(on: boolean): void {
    if (on === this.sparksOn || !this.sparks) return;
    this.sparksOn = on;
    this.sparks.node.active = on;
  }

  private setSheetAlpha(alpha: number): void {
    const a = toByte(alpha);
    if (a === this.sheetAlpha || !this.sheet) return;
    this.sheetAlpha = a;
    this.color.a = a;
    this.sheet.color = this.color;
  }

  private setSparkAlpha(alpha: number): void {
    const a = toByte(alpha);
    if (a === this.sparkAlpha || !this.sparks) return;
    this.sparkAlpha = a;
    this.color.a = a;
    this.sparks.color = this.color;
  }
}

function toByte(alpha: number): number {
  return Math.round(Math.max(0, Math.min(1, alpha)) * 255);
}
