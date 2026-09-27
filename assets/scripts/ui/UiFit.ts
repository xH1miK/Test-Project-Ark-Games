import { _decorator, Component, ResolutionPolicy, screen, view } from 'cc';
import { Config } from '../core/Config';
import { fitFrame } from './FrameFit';

const { ccclass, disallowMultiple } = _decorator;

/**
 * Keeps the whole portrait design frame (Config.ui) on screen in any orientation: on start and on
 * every resize it sets a design resolution that fits the frame and extends it along the spare side.
 * Widgets then pin the HUD to the real screen edges. Put it on the Canvas (Unity analogy: a
 * CanvasScaler with "match" switched by the aspect ratio).
 */
@ccclass('UiFit')
@disallowMultiple
export class UiFit extends Component {
  protected onEnable(): void {
    this.apply();
    screen.on('window-resize', this.apply, this);
    screen.on('orientation-change', this.apply, this);
    screen.on('fullscreen-change', this.apply, this);
  }

  protected onDisable(): void {
    screen.off('window-resize', this.apply, this);
    screen.off('orientation-change', this.apply, this);
    screen.off('fullscreen-change', this.apply, this);
  }

  private apply(): void {
    const { width, height } = screen.windowSize;
    if (width <= 0 || height <= 0) return;
    const size = fitFrame(width, height, Config.ui.designWidth, Config.ui.designHeight);
    view.setDesignResolutionSize(size.width, size.height, ResolutionPolicy.FIXED_WIDTH);
  }
}
