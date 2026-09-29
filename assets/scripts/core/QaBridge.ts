/**
 * Test hooks for the headless autopilot (tools/check-html.mjs --scenario): when the page URL has
 * `?qa`, the given objects are published on `window.__zm` so a scenario can read models and drive
 * input. Normal runs expose nothing.
 */
/** True when the page URL has the flag (`?nopeek`): scenarios switch the start camera beat off so the camera sits on the tractor. */
export function qaFlag(name: string): boolean {
  const host = globalThis as { location?: { search: string } };
  return !!host.location && new RegExp(`[?&]${name}(=|&|$)`).test(host.location.search);
}

export function exposeForQa(api: Record<string, unknown>): void {
  const host = globalThis as { location?: { search: string }; __zm?: Record<string, unknown> };
  if (!host.location || !/[?&]qa(=|&|$)/.test(host.location.search)) return;
  host.__zm = Object.assign(host.__zm ?? {}, api);
}
