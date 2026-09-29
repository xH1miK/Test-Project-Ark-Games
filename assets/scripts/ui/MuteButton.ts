import { _decorator, Component, EventTouch, Node, Sprite, SpriteFrame, Tween, Vec3, tween } from 'cc';
import { Config } from '../core/Config';

const { ccclass, property } = _decorator;

/**
 * The mute button (bottom-left, under Canvas/Hud): draws the speaker with or without the red slash and tells its
 * owner when it is tapped (pressed and released inside the touch area; sliding off cancels it). The node is the touch
 * area (bigger than the icon, a finger is not 100 units of the design frame), the icon is its child. The full-screen
 * joystick is drawn above the Hud and would swallow the touch, so it leaves the touches that start on this node to
 * the node below (JoystickView.passThrough). Silent on purpose, as the example's.
 */
@ccclass('MuteButton')
export class MuteButton extends Component {
  @property({ type: Sprite, tooltip: 'The speaker icon, a child of this node.' })
  icon: Sprite | null = null;

  @property({ type: SpriteFrame, tooltip: 'Shown while the sound is on.' })
  soundOn: SpriteFrame | null = null;

  @property({ type: SpriteFrame, tooltip: 'Shown while the sound is muted (the slash).' })
  soundOff: SpriteFrame | null = null;

  private onTap: (() => void) | null = null;
  private shownMuted: boolean | null = null;
  private pressed = false;

  /** Called once by GameRoot: `onTap` runs on every tap. */
  bind(onTap: () => void): void {
    if (!this.icon || !this.soundOn || !this.soundOff) throw new Error('MuteButton: needs the icon sprite and both frames');
    this.onTap = onTap;
  }

  /** Draws the state (GameRoot calls it every frame; nothing happens unless it changed). */
  render(muted: boolean): void {
    if (muted === this.shownMuted || !this.icon) return;
    this.shownMuted = muted;
    this.icon.spriteFrame = muted ? this.soundOff : this.soundOn;
  }

  protected onEnable(): void {
    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    this.pressed = false;
    if (this.icon) {
      Tween.stopAllByTarget(this.icon.node);
      this.icon.node.setScale(1, 1, 1);
    }
  }

  private onTouchStart(event: EventTouch): void {
    event.propagationStopped = true;
    this.pressed = true;
    this.squeeze(Config.ui.muteButton.pressScale, Config.ui.muteButton.pressTime, 'sineOut');
  }

  private onTouchEnd(event: EventTouch): void {
    event.propagationStopped = true;
    if (!this.pressed) return;
    this.pressed = false;
    this.squeeze(1, Config.ui.muteButton.releaseTime, 'backOut');
    this.onTap?.();
  }

  private onTouchCancel(event: EventTouch): void {
    event.propagationStopped = true;
    if (!this.pressed) return;
    this.pressed = false;
    this.squeeze(1, Config.ui.muteButton.releaseTime, 'backOut');
  }

  private squeeze(scale: number, time: number, easing: 'sineOut' | 'backOut'): void {
    if (!this.icon) return;
    const node = this.icon.node;
    Tween.stopAllByTarget(node);
    tween(node).to(time, { scale: new Vec3(scale, scale, 1) }, { easing }).start();
  }
}
