import { _decorator, Component, Label, Node } from 'cc';
import { Config } from '../core/Config';

const { ccclass, property } = _decorator;

/**
 * The coin counter in the HUD: shows the purse total and swells ("punch") when coins arrive. Knows
 * no rules: GameRoot hands it the total on every purse change. The swell is retriggerable: while
 * coins keep arriving it stays up instead of snapping back and forth.
 */
@ccclass('CoinHud')
export class CoinHud extends Component {
  @property({ type: Label, tooltip: 'The number.' })
  amount: Label | null = null;

  @property({ type: Node, tooltip: 'What swells when coins arrive: the plate with the icon and the number.' })
  punchNode: Node | null = null;

  @property({ type: Node, tooltip: 'The coin icon: where flying coins land.' })
  icon: Node | null = null;

  private total = -1;
  /** Swell 0..1 and whether it is on its way up. */
  private swell = 0;
  private rising = false;

  /** The total shown right now (QA checks read it). */
  get shown(): number {
    return this.total;
  }

  /** Shows the purse total; a rise swells the counter unless `punch` is false. */
  show(total: number, punch = true): void {
    if (total === this.total) return;
    const rise = total > this.total && this.total >= 0;
    this.total = total;
    if (this.amount) this.amount.string = String(total);
    if (punch && rise) this.rising = true;
  }

  protected update(dt: number): void {
    if (!this.rising && this.swell === 0) return;
    const half = Config.ui.coinHud.punchTime / 2;
    if (this.rising) {
      this.swell = Math.min(1, this.swell + dt / half);
      if (this.swell === 1) this.rising = false;
    } else {
      this.swell = Math.max(0, this.swell - dt / half);
    }
    // Ease out on the way up and in on the way down: a quick pop that settles softly.
    const s = 1 + (Config.ui.coinHud.punchScale - 1) * Math.sin((this.swell * Math.PI) / 2);
    this.punchNode?.setScale(s, s, 1);
  }
}
