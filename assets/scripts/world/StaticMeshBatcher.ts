import { _decorator, BatchingUtility, Component, Node } from 'cc';

const { ccclass } = _decorator;

/**
 * Merges every MeshRenderer below this node into one mesh at startup (Cocos static batching), so a
 * wall of ~50 rocks costs one draw call. All renderers must share one material. The source renderers
 * get disabled and the nodes must not move afterwards (Unity analogy: static batching of "Static" objects).
 * Collision is unaffected: GameRoot reads the source meshes in onLoad, before this runs.
 */
@ccclass('StaticMeshBatcher')
export class StaticMeshBatcher extends Component {
  protected start(): void {
    const parent = this.node.parent;
    if (!parent) return;
    // The merged mesh is expressed in this node's space, so its holder gets the same transform.
    const batched = new Node(`${this.node.name}Batched`);
    parent.addChild(batched);
    batched.setPosition(this.node.position);
    batched.setRotation(this.node.rotation);
    batched.setScale(this.node.scale);
    if (!BatchingUtility.batchStaticModel(this.node, batched)) {
      batched.destroy();
      console.warn(`StaticMeshBatcher: '${this.node.name}' could not be batched; drawing the meshes one by one`);
    }
  }
}
