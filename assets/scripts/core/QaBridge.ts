/**
 * Test hooks for the headless autopilot (tools/check-html.mjs --scenario): when the page URL has
 * `?qa`, the given objects are published on `window.__zm` so a scenario can read models and drive
 * input. Normal runs expose nothing.
 */
export function exposeForQa(api: Record<string, unknown>): void {
  const host = globalThis as { location?: { search: string }; __zm?: Record<string, unknown> };
  if (!host.location || !/[?&]qa(=|&|$)/.test(host.location.search)) return;
  host.__zm = Object.assign(host.__zm ?? {}, api);
}
