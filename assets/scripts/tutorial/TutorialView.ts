import { _decorator, Color, Component, Material, Mesh, MeshRenderer, Node, utils } from 'cc';
import { Config } from '../core/Config';
import { buildArrowGeometry } from './ArrowGeometry';
import type { TutorialMarkers } from './TutorialMarkers';

const { ccclass } = _decorator;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Draws the tutorial's two markers, the path arrow before the tractor and the pointer over the target:
 * one arrow mesh built in code (ArrowGeometry) on one lit green material, two nodes of the main
 * camera's world (Default layer, depth tested like everything else in it, no shadows). Put it on an
 * empty node at the origin; the numbers come from TutorialMarkers.
 */
@ccclass('TutorialView')
export class TutorialView extends Component {
  private arrow: Node | null = null;
  private pointer: Node | null = null;
  private arrowOn = false;
  private pointerOn = false;

  protected onLoad(): void {
    const { color, arrowScale, pointerScale, pointerPitch } = Config.tutorial.look;
    const mesh = utils.MeshUtils.createMesh(buildArrowGeometry(), new Mesh());
    const material = new Material();
    // Both markers share the mesh and the material: instanced, they are one draw call.
    material.initialize({ effectName: 'builtin-standard', defines: { USE_INSTANCING: true } });
    material.setProperty('albedo', new Color(color[0], color[1], color[2], 255));
    material.setProperty('roughness', 0.9);
    material.setProperty('metallic', 0);
    this.arrow = this.makeMarker('PathArrow', mesh, material);
    this.arrow.setScale(arrowScale, arrowScale, arrowScale);
    this.pointer = this.makeMarker('Pointer', mesh, material);
    this.pointer.setScale(pointerScale, pointerScale, pointerScale);
    // The pointer's tilt never changes: nose down, facing the way the camera looks.
    this.pointer.setRotationFromEuler(pointerPitch, Config.camera.yaw, 0);
  }

  /** Applies the markers' state (GameRoot calls it every frame, after the markers have moved). */
  render(markers: TutorialMarkers): void {
    const { arrow, pointer } = this;
    if (!arrow || !pointer) return;
    if (markers.arrowShown !== this.arrowOn) arrow.active = this.arrowOn = markers.arrowShown;
    if (markers.pointerShown !== this.pointerOn) pointer.active = this.pointerOn = markers.pointerShown;
    // This node sits at the origin without a turn or a scale: local is world.
    if (this.arrowOn) {
      arrow.setPosition(markers.arrowX, markers.arrowY, markers.arrowZ);
      arrow.setRotationFromEuler(0, markers.arrowYaw * RAD_TO_DEG, 0);
    }
    if (this.pointerOn) pointer.setPosition(markers.pointerX, markers.pointerY, markers.pointerZ);
  }

  private makeMarker(name: string, mesh: Mesh, material: Material): Node {
    const node = new Node(name);
    node.active = false;
    this.node.addChild(node);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = mesh;
    renderer.material = material;
    renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
    renderer.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
    return node;
  }
}
