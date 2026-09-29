import { _decorator, Component, EventTouch, Node, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import { Config } from '../core/Config';
import type { JoystickModel } from './JoystickModel';

const { ccclass, property } = _decorator;

const tmpUi = new Vec2();
const tmpScreen = new Vec2();
const tmpLocal = new Vec3();

/**
 * Floating joystick on screen: forwards touches on its full-screen area to the model and draws the
 * base and the knob from the model. Put it on a UI node stretched over the canvas (Widget), with the
 * ring as a child and the knob as the ring's child (Unity analogy: an on-screen stick whose touch
 * area is a full-screen raycast target). The first finger owns the stick; others are ignored.
 * It sits above the Hud in draw order (the UI-on-top rule), so it would swallow the touches of the Hud's buttons: a
 * touch that starts inside one of `passThrough` is left alone (the engine's `preventSwallow`: the event goes on to
 * the node below), whatever the stick is doing, and the rest of that finger's touch is left alone too.
 */
@ccclass('JoystickView')
export class JoystickView extends Component {
  @property({ type: Node, tooltip: 'Ring sprite, a child of this node; needs a UIOpacity for the idle fade.' })
  base: Node | null = null;

  @property({ type: Node, tooltip: 'Knob sprite, a child of the ring.' })
  knob: Node | null = null;

  @property({ type: [Node], tooltip: "UI nodes below this one (the Hud's buttons) whose touches the stick leaves to them." })
  passThrough: Node[] = [];

  private model: JoystickModel | null = null;
  private area: UITransform | null = null;
  private fade: UIOpacity | null = null;
  private touchId: number | null = null;
  /** The finger that started on a pass-through node: none of its events are ours. */
  private leftAlone: number | null = null;

  /** Called once by GameRoot. */
  bind(model: JoystickModel): void {
    this.model = model;
    this.area = this.getComponent(UITransform);
    if (!this.area || !this.base || !this.knob) throw new Error('JoystickView: needs a UITransform, base and knob');
    this.fade = this.base.getComponent(UIOpacity);
    const { radius, knobRadius } = Config.joystick;
    this.base.getComponent(UITransform)?.setContentSize(2 * radius, 2 * radius);
    this.knob.getComponent(UITransform)?.setContentSize(2 * knobRadius, 2 * knobRadius);
    this.onResize();
    this.render();
  }

  /** Draws the current model state (GameRoot calls it every frame). */
  render(): void {
    const model = this.model;
    if (!model) return;
    this.base?.setPosition(model.base.x, model.base.y, 0);
    this.knob?.setPosition(model.knob.x, model.knob.y, 0);
    if (this.fade) {
      const idle = Config.joystick.idleOpacity;
      this.fade.opacity = (idle + (255 - idle) * model.engaged) * model.visibility;
    }
  }

  protected onEnable(): void {
    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    this.node.on(Node.EventType.SIZE_CHANGED, this.onResize, this);
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    this.node.off(Node.EventType.SIZE_CHANGED, this.onResize, this);
    if (this.touchId !== null) {
      this.touchId = null;
      this.model?.release();
    }
  }

  private onResize(): void {
    if (!this.model || !this.area) return;
    this.model.setArea(this.area.width, this.area.height);
  }

  private onTouchStart(event: EventTouch): void {
    if (this.overPassThrough(event)) {
      this.leftAlone = event.getID();
      event.preventSwallow = true;
      return;
    }
    if (!this.model || this.touchId !== null) return;
    this.touchId = event.getID();
    const p = this.toArea(event);
    this.model.press(p.x, p.y);
  }

  private onTouchMove(event: EventTouch): void {
    if (event.getID() === this.leftAlone) {
      event.preventSwallow = true;
      return;
    }
    if (!this.model || event.getID() !== this.touchId) return;
    const p = this.toArea(event);
    this.model.drag(p.x, p.y);
  }

  private onTouchEnd(event: EventTouch): void {
    if (event.getID() === this.leftAlone) {
      event.preventSwallow = true;
      this.leftAlone = null;
      return;
    }
    if (!this.model || event.getID() !== this.touchId) return;
    this.touchId = null;
    this.model.release();
  }

  private overPassThrough(event: EventTouch): boolean {
    event.getLocation(tmpScreen);
    for (const node of this.passThrough) {
      if (node?.activeInHierarchy && node.getComponent(UITransform)?.hitTest(tmpScreen, event.windowId)) return true;
    }
    return false;
  }

  /** Touch point in this node's space (origin at its anchor, which is the centre). */
  private toArea(event: EventTouch): Vec3 {
    event.getUILocation(tmpUi);
    tmpLocal.set(tmpUi.x, tmpUi.y, 0);
    return this.area!.convertToNodeSpaceAR(tmpLocal, tmpLocal);
  }
}
