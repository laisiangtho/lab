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
 * @param {{ accept?: string }} [options]
 * @returns {Promise<{ name: string, size: number, text: string } | null>} null when cancelled
 */
export function pickText({ accept = '' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        resolve({ name: file.name, size: file.size, text: await file.text() });
      } catch (err) {
        reject(new Error(`${file.name}: could not be read (${err.message})`));
      }
    }, { once: true });
    input.click();
  });
}
