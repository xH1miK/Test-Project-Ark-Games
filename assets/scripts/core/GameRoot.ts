import { _decorator, Component, Node } from 'cc';
import { Config } from './Config';
import { EventBus } from './Events';
import type { GameEvents } from './Events';
import { exposeForQa } from './QaBridge';
import type { ObstacleGrid } from '../world/ObstacleGrid';
import { buildObstacleGrid } from '../world/StaticBlocker';

const { ccclass, property } = _decorator;

/**
 * Composition root: creates the models, wires them to the scene's views and drives the frame in a
 * fixed order. The only place that knows every system (Unity analogy: a bootstrap MonoBehaviour).
 */
@ccclass('GameRoot')
export class GameRoot extends Component {
  @property({ type: Node, tooltip: 'Root of the static level; every StaticBlocker below it becomes collision.' })
  level: Node | null = null;

  readonly events = new EventBus<GameEvents>();
  private obstacles!: ObstacleGrid;

  protected onLoad(): void {
    if (!this.level) throw new Error('GameRoot: level is not assigned');
    this.obstacles = buildObstacleGrid(this.level, Config.world.bounds, Config.world.cellSize);
    exposeForQa({ obstacles: this.obstacles, events: this.events });
  }
}
