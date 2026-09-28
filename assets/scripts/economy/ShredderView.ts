import { _decorator, Component, Node, Quat, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

const tmpTurn = new Quat();
const tmpRotation = new Quat();

/** What the view reads from the shredder model. */
export interface ShredderRollers {
  /** Roller turn so far, radians. */
  readonly rollerAngle: number;
}

/**
 * The shredder in the scene: turns its rollers by the model's roller angle, each about its own X axis
 * with its top moving toward the middle, so the two rollers pull balls down between them. Put it on
 * the shredder node (the model's shredder stands where this node is).
 */
@ccclass('ShredderView')
export class ShredderView extends Component {
  @property({ type: [Node], tooltip: 'Roller nodes (roll_*): each turns about its own X axis.' })
  rollers: Node[] = [];

  private readonly rest: Quat[] = [];
  private readonly direction: number[] = [];
  private shownAngle = NaN;

  /** Applies the rollers' turn (GameRoot calls it every frame, the first time from its onLoad). */
  render(model: ShredderRollers): void {
    if (model.rollerAngle === this.shownAngle) return;
    // The rollers' own pose is their rest (taken on the first call, whatever order the nodes load in).
    if (this.rest.length !== this.rollers.length) this.takeRest();
    this.shownAngle = model.rollerAngle;
    for (let k = 0; k < this.rollers.length; k++) {
      Quat.fromAxisAngle(tmpTurn, Vec3.UNIT_X, this.direction[k] * model.rollerAngle);
      Quat.multiply(tmpRotation, this.rest[k], tmpTurn);
      this.rollers[k].setRotation(tmpRotation);
    }
  }

  private takeRest(): void {
    this.rest.length = 0;
    this.direction.length = 0;
    for (const roller of this.rollers) {
      this.rest.push(roller.rotation.clone());
      // The top of a roller on the +Z side of its parent turns toward -Z, and the other way round.
      this.direction.push(roller.position.z > 0 ? -1 : 1);
    }
  }
}
