/**
 * IPC handlers behind window.lai. Each handler validates its sender and input;
 * the renderer is treated as untrusted.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { VERSION } from '../../../app/version.js';
import { isAppUrl, isNewer, saveFilters } from './policy.js';
import { rendererUrl } from './window.js';

/** The largest file fetch-bytes will download: a whole Bible zip is well under this. */
const MAX_DOWNLOAD = 150 * 1024 * 1024;

/** A download that sends nothing for this long is given up. */
const IDLE_TIMEOUT = 30_000;

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
      filters: saveFilters(options.defaultName),
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
   * The check runs here rather than in the renderer, which is held to the
   * page's content policy and to GitHub's CORS answers; here neither applies.
   * Nothing is downloaded or installed — the answer is a version and a link,
   * and the reader decides.
   *
   * The running build is VERSION from app/version.js (yy.mm.dd.build), the
   * same form as a release tag. app.getVersion() is package.json's semver
   * (26.10.1), which drops the build number: compared with it, every build
   * of a day would call the day's own release newer.
   */
  handle('lai:check-update', async () => {
    const current = VERSION;
    const response = await fetch(RELEASES_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `${app.getName()}/${current}` },
    });
    if (!response.ok) throw new Error(`update check: HTTP ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name ?? '').replace(/^v/, '');
    if (!latest) throw new Error('update check: the latest release has no version');
    return { current, latest, url: release.html_url, newer: isNewer(latest, current) };
  });

  /**
   * Download a file the reader asked for — a translation from eBible.org, or
   * one at a web address they typed — from this process rather than the page.
   * A page is held to what each site allows pages to fetch, and many Bible
   * sites allow none; this process is not. https only, and no more than
   * MAX_DOWNLOAD bytes, so a wrong address cannot fill the disk.
   */
  handle('lai:fetch-bytes', async (_event, url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error(`fetch-bytes: refusing non-https URL ${u.href}`);
    // A server that stops sending is given up after IDLE_TIMEOUT, rather than
    // left holding the call open; the clock restarts with every chunk, so a
    // large file on a slow line is not cut off for being large.
    const abort = new AbortController();
    let idle = setTimeout(() => abort.abort(), IDLE_TIMEOUT);
    const alive = () => { clearTimeout(idle); idle = setTimeout(() => abort.abort(), IDLE_TIMEOUT); };
    try {
      return await download(u, abort.signal, alive);
    } catch (err) {
      if (abort.signal.aborted) throw new Error(`${u.href} sent nothing for ${IDLE_TIMEOUT / 1000} s`);
      throw err;
    } finally {
      clearTimeout(idle);
    }
  });

  async function download(u, signal, alive) {
    const response = await fetch(u.href, { headers: { 'user-agent': `${app.getName()}/${VERSION}` }, redirect: 'follow', signal });
    // Redirects are followed, but what is read must still come over https.
    if (new URL(response.url).protocol !== 'https:') {
      await response.body?.cancel();
      throw new Error(`fetch-bytes: ${u.href} redirected to ${response.url}, which is not https`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${u.href}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_DOWNLOAD) throw new Error(`${u.href} is ${Math.round(declared / 1048576)} MB, more than a translation can be`);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      total += value.byteLength;
      if (total > MAX_DOWNLOAD) { await reader.cancel(); throw new Error(`${u.href} is more than ${MAX_DOWNLOAD / 1048576} MB, more than a translation can be`); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
    return { bytes: out, type: response.headers.get('content-type') ?? '' };
  }

  // `runtime` is a display string: shared code prints it without knowing what
  // this target runs on (app/ must stay target-agnostic).
  handle('lai:app-info', () => ({
    name: app.getName(),
    version: VERSION,
    runtime: `Electron ${process.versions.electron}`,
    platform: process.platform,
  }));
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    // Only the app's own pages may ask. Not by URL.origin, which Node gives as
    // 'null' for app:, file: and data: alike (see policy.js).
    if (!event.senderFrame || !isAppUrl(event.senderFrame.url, rendererUrl())) {
      throw new Error(`${channel}: rejected sender ${event.senderFrame?.url ?? '(none)'}`);
    }
    return fn(event, ...args);
  });
}
