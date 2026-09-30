/**
 * Design resolution that shows the whole design frame on any screen: the frame is scaled to fit
 * (like "contain") and the design area grows along the spare side. In portrait the width stays at the
 * frame width and the height grows; in landscape the height stays and the width grows.
 * Pure TypeScript: no engine imports.
 */
export function fitFrame(
  screenWidth: number,
  screenHeight: number,
  frameWidth: number,
  frameHeight: number,
): { width: number; height: number } {
  const scale = Math.min(screenWidth / frameWidth, screenHeight / frameHeight);
  return { width: screenWidth / scale, height: screenHeight / scale };
}

/** Gaps between the screen's edges and its safe area, design units. */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The gaps of a safe rectangle inside the design area (both in design units, origin at the bottom-left, +Y up: what
 * `sys.getSafeAreaRect` returns). Never negative; a gap of a hundredth of a unit is rounding noise and counts as none.
 */
export function safeInsets(rect: { x: number; y: number; width: number; height: number }, designWidth: number, designHeight: number): Insets {
  const gap = (v: number): number => (v > 0.01 ? v : 0);
  return {
    left: gap(rect.x),
    bottom: gap(rect.y),
    right: gap(designWidth - (rect.x + rect.width)),
    top: gap(designHeight - (rect.y + rect.height)),
  };
}
