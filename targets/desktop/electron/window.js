/**
 * Main window lifecycle and navigation policy.
 */
import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';

import { APP_ORIGIN } from './protocol.js';
import { loadWindowState, watchWindowState } from './state.js';

const PRELOAD = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));

/** Dev server URL (set by electron-vite in development), otherwise app://. */
export function rendererUrl() {
  const dev = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && dev ? dev : `${APP_ORIGIN}/index.html`;
}

/** The dark background the app starts on, so the first paint is not a white flash. */
const BACKGROUND = '#181818';

/**
 * The window's own chrome.
 *
 * The application's top row is a band of its own — tabs, navigation, the panel
 * toggles — and a system title bar above it wastes a strip of every screen on
 * a second, emptier one. So the title bar is hidden and the window buttons are
 * drawn over the app's band: the traffic lights on macOS, and on Windows and
 * Linux the caption buttons of the title-bar overlay (drawn on Linux since
 * Electron 28). The buttons stay Electron's own; nothing here draws a close
 * button of its own, so a window never ends up with no way to close it.
 *
 * The renderer is told which arrangement it got (see preload) so the band can
 * leave room in the right corner.
 */
function frame() {
  if (process.platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } };
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: BACKGROUND, symbolColor: '#b8b8b8', height: 38 } };
}

export function createMainWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x === undefined ? {} : { x: state.x, y: state.y }),
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: BACKGROUND,
    title: 'Lai Siangtho',
    ...frame(),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const origin = new URL(rendererUrl()).origin;
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (state.maximised) win.maximize();
  watchWindowState(win);

  win.once('ready-to-show', () => win.show());
  win.loadURL(rendererUrl());
  return win;
}
