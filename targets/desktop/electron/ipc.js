/**
 * IPC handlers behind window.lai. Each handler validates its sender and input;
 * the renderer is treated as untrusted.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { rendererUrl } from './window.js';

/** Where releases are published; the packaging config points at the same repository. */
const RELEASES_URL = 'https://api.github.com/repos/laisiangtho/lab/releases/latest';

export function registerIpc() {
  handle('lai:save-file', async (event, options) => {
    if (typeof options?.defaultName !== 'string' || typeof options?.content !== 'string') {
      throw new Error('save-file: expected { defaultName: string, content: string }');
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: basename(options.defaultName),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { saved: false };
    await writeFile(filePath, options.content, 'utf8');
    return { saved: true, path: filePath };
  });

  /**
   * The window-button overlay's colours and height, so the corner matches the
   * band it sits on: its colours in every theme, and its height at every
   * interface size (the band is sized from the reader's --ui-size, and an
   * overlay taller than the band covers the top of the sheet below it). Only a
   * window created with an overlay has one (Windows and Linux; macOS draws its
   * traffic lights on the band).
   */
  handle('lai:window-frame', (event, frame) => {
    const hex = /^#[0-9a-f]{6}$/i;
    const height = frame?.height;
    if (!hex.test(frame?.color ?? '') || !hex.test(frame?.symbolColor ?? '')
      || !Number.isInteger(height) || height < 16 || height > 96) {
      throw new Error('window-frame: expected { color: "#rrggbb", symbolColor: "#rrggbb", height: integer 16–96 }');
    }
    if (process.platform === 'darwin') throw new Error('window-frame: macOS windows have no title-bar overlay');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('window-frame: the sender has no window');
    win.setTitleBarOverlay({ color: frame.color, symbolColor: frame.symbolColor, height });
  });

  handle('lai:open-external', async (_event, url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error(`open-external: refusing non-https URL ${u.href}`);
    await shell.openExternal(u.href);
  });

  /**
   * Is there a newer release?
   *
   * The check runs here rather than in the renderer: the page's content policy
   * allows the catalog host and nothing else, and widening it for a version
   * check would be a poor trade. Nothing is downloaded or installed — the
   * answer is a version and a link, and the reader decides.
   */
  handle('lai:check-update', async () => {
    const current = app.getVersion();
    const response = await fetch(RELEASES_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `${app.getName()}/${current}` },
    });
    if (!response.ok) throw new Error(`update check: HTTP ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name ?? '').replace(/^v/, '');
    if (!latest) throw new Error('update check: the latest release has no version');
    return { current, latest, url: release.html_url, newer: isNewer(latest, current) };
  });

  // `runtime` is a display string: shared code prints it without knowing what
  // this target runs on (app/ must stay target-agnostic).
  handle('lai:app-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    runtime: `Electron ${process.versions.electron}`,
    platform: process.platform,
  }));
}

/**
 * Compare two `yy.mm.dd.build` versions numerically, part by part. String
 * comparison would call 26.9.24 newer than 26.10.1.
 */
function isNewer(latest, current) {
  const parts = (v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const origin = new URL(rendererUrl()).origin;
    if (new URL(event.senderFrame.url).origin !== origin) {
      throw new Error(`${channel}: rejected sender ${event.senderFrame.url}`);
    }
    return fn(event, ...args);
  });
}
