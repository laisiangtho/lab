/**
 * The desktop's decisions that need no Electron: which addresses are the app
 * itself, and whether a release is newer than the running build. Kept apart so
 * they are tested without starting Electron (test/desktop-policy.test.js).
 */

/**
 * Is `url` a page of the app being served from `base` (app://lai/... in a
 * packaged build, the dev server's address in development)?
 *
 * Compared by protocol and host, not by `URL.origin`: Node's URL gives the
 * origin of every non-special scheme as the string 'null', so app://lai,
 * app://other, file:, data: and about:blank would all compare equal to it.
 *
 * @param {string} url
 * @param {string} base
 */
export function isAppUrl(url, base) {
  let u;
  let b;
  try {
    u = new URL(String(url));
    b = new URL(String(base));
  } catch {
    return false;
  }
  return u.protocol === b.protocol && u.host === b.host && u.host !== '';
}

/**
 * Compare two `yy.mm.dd.build` versions numerically, part by part. String
 * comparison would call 26.9.24 newer than 26.10.1. A missing part counts as
 * 0, so 26.10.01 and 26.10.01.0 are the same build.
 *
 * @param {string} latest
 * @param {string} current
 */
export function isNewer(latest, current) {
  const parts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * The file-type filter for a save dialog, from the name being suggested:
 * a Markdown export is offered as Markdown, not as a text file.
 *
 * @param {string} name
 * @returns {{ name: string, extensions: string[] }[]}
 */
export function saveFilters(name) {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(String(name))?.[1]?.toLowerCase();
  const known = { md: 'Markdown', txt: 'Text', json: 'JSON', html: 'HTML', csv: 'CSV' };
  if (!ext) return [{ name: 'All files', extensions: ['*'] }];
  return [{ name: known[ext] ?? ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }];
}
