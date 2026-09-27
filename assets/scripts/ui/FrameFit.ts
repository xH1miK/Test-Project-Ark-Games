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
