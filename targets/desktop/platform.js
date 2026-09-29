/**
 * Desktop platform services, backed by the preload bridge (window.lai).
 * The renderer has no Node.js access; every native action goes through IPC.
 */
export function createPlatform() {
  const bridge = window.lai;
  if (!bridge) throw new Error('desktop platform: window.lai is missing — the preload script did not run');
  return Object.freeze({
    id: 'desktop',
    /** 'inset' (macOS traffic lights) or 'overlay' (caption buttons at the end). */
    frame: bridge.frame ?? null,
    capabilities: Object.freeze({
      saveFile: (options) => bridge.saveFile(options),
      openExternal: (url) => bridge.openExternal(url),
      appInfo: () => bridge.appInfo(),
      checkUpdate: () => bridge.checkUpdate(),
      // Only where the window buttons are an overlay the app can colour.
      ...(bridge.frame === 'overlay' ? { frameColors: (colors) => bridge.setFrameColors(colors) } : {}),
    }),
  });
}
