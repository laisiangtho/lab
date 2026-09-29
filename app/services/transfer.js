/**
 * Moving small JSON files in and out of the app with plain browser APIs, which
 * behave the same in every target (both render in a browser engine).
 *
 * Native OS dialogs are a platform capability instead (see each target's platform.js);
 * this service is what a target has without one.
 */

/** Hand the user a JSON file (browser download, no native dialog). */
export function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Ask for one JSON file.
 * @returns {Promise<{ name: string, data: unknown } | null>} null when cancelled
 */
export function pickJson() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        resolve({ name: file.name, data: JSON.parse(await file.text()) });
      } catch (err) {
        reject(new Error(`${file.name}: invalid JSON (${err.message})`));
      }
    }, { once: true });
    input.click();
  });
}

/**
 * Ask for one file of any kind, as text.
 *
 * `pickJson` above parses as it reads, which is right for this app's own files
 * and wrong for somebody else's: an import has to see the text before it can
 * know what it is, and a file that is not JSON is not an error here — it is a
 * USFM file, and the next step is to say so.
 *
 * Both forms come back: the text for anything that is text, and the bytes for
 * anything that is not — an archive is read as bytes and its members as text.
 *
 * @param {{ accept?: string }} [options]
 * @returns {Promise<{ name: string, size: number, text: string, bytes: Uint8Array } | null>}
 *          null when cancelled
 */
export function pickFile({ accept = '' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // A zip decoded as UTF-8 is mojibake, which is harmless: the caller
        // looks at the bytes to decide, and never at that text.
        resolve({ name: file.name, size: file.size, bytes, text: new TextDecoder().decode(bytes) });
      } catch (err) {
        reject(new Error(`${file.name}: could not be read (${err.message})`));
      }
    }, { once: true });
    input.click();
  });
}

/**
 * Hand the reader a file this app just made.
 *
 * The platform's own save dialog where there is one (the desktop build), and a
 * download where there is not — the same split every other export here takes.
 *
 * @param {string} filename
 * @param {string|Blob} content
 */
export function saveText(filename, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // In the document, briefly. A detached anchor's `download` is honoured by
  // some browsers and ignored by others, and a file that arrives called
  // "download" with no extension is a file nobody can open.
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
}
