import { _decorator, Component, Widget, screen, sys, view } from 'cc';
import { safeInsets } from './FrameFit';
import type { Insets } from './FrameFit';

const { ccclass, requireComponent, disallowMultiple } = _decorator;

/**
 * Keeps the Hud out of a screen's cut-outs and rounded corners: the engine reads the page's CSS
 * `env(safe-area-inset-*)` (the packed page defines `--safe-*` from them; a browser gives non-zero values only when the
 * page asks for the whole screen with `viewport-fit=cover`, otherwise it keeps the page inside the safe area itself),
 * `sys.getSafeAreaRect` gives the safe rectangle in design units, and this component turns the gaps into the margins of
 * the Hud's Widget: every HUD element (the coin counter, the mute button, the finale) then sits inside the safe area
 * while the 3D world and the joystick's touch area still fill the screen. The joystick is told the same gaps (its rest
 * point lifts above a home indicator). Put it on the Hud, next to its Widget (Unity analogy: a SafeArea script on the
 * canvas panel).
 */
@ccclass('SafeAreaFit')
@requireComponent(Widget)
@disallowMultiple
export class SafeAreaFit extends Component {
  /** The gaps applied now, design units. */
  readonly insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private onChange: ((insets: Insets) => void) | null = null;

  /** `callback` runs now and whenever the gaps change. */
  listen(callback: (insets: Insets) => void): void {
    this.onChange = callback;
    callback(this.insets);
  }

  protected onEnable(): void {
    this.apply();
    screen.on('window-resize', this.reapply, this);
    screen.on('orientation-change', this.reapply, this);
    screen.on('fullscreen-change', this.reapply, this);
  }

  protected onDisable(): void {
    screen.off('window-resize', this.reapply, this);
    screen.off('orientation-change', this.reapply, this);
    screen.off('fullscreen-change', this.reapply, this);
    this.unschedule(this.apply);
  }

  /** The design resolution is set by UiFit on the same events: read again next frame, when it is surely done. */
  private reapply(): void {
    this.apply();
    this.unschedule(this.apply);
    this.scheduleOnce(this.apply, 0);
  }

  private apply(): void {
    const widget = this.getComponent(Widget);
    if (!widget) return;
    const design = view.getDesignResolutionSize();
    const next = safeInsets(sys.getSafeAreaRect(false), design.width, design.height);
    const now = this.insets;
    if (next.left === now.left && next.right === now.right && next.top === now.top && next.bottom === now.bottom) return;
    now.left = next.left;
    now.right = next.right;
    now.top = next.top;
    now.bottom = next.bottom;
    widget.left = now.left;
    widget.right = now.right;
    widget.top = now.top;
    widget.bottom = now.bottom;
    widget.updateAlignment();
    this.onChange?.(now);
  }
}
