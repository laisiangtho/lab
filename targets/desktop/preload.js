/**
 * Preload (sandboxed, context-isolated). Exposes a minimal, explicit API as
 * window.lai; no Electron or Node object crosses into the renderer.
 * Built as CommonJS (out/preload/index.cjs), as sandboxed preloads require.
 */
import { contextBridge, ipcRenderer } from 'electron';

// Which window chrome the main process asked for, so the top band can leave
// room where the system's own buttons are drawn (see electron/window.js).
const FRAME = process.platform === 'darwin' ? 'inset' : 'overlay';

contextBridge.exposeInMainWorld('lai', Object.freeze({
  frame: FRAME,
  /** @param {{ defaultName: string, content: string }} options */
  saveFile: (options) => ipcRenderer.invoke('lai:save-file', options),
  openExternal: (url) => ipcRenderer.invoke('lai:open-external', url),
  appInfo: () => ipcRenderer.invoke('lai:app-info'),
  checkUpdate: () => ipcRenderer.invoke('lai:check-update'),
  /** @param {string} url https only; resolves { bytes: Uint8Array, type } */
  fetchBytes: (url) => ipcRenderer.invoke('lai:fetch-bytes', url),
  /** @param {{ color: string, symbolColor: string, height: number }} frame  '#rrggbb', '#rrggbb', px */
  setWindowFrame: (frame) => ipcRenderer.invoke('lai:window-frame', frame),
}));
