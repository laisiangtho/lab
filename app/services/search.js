/**
 * Search client: one worker, one live query. Starting a query abandons the
 * previous one, so typing does not queue up scans.
 */

const cancelled = () => ({
  verses: 0, chapters: 0, books: 0, shown: 0, total: 0,
  scanned: 0, ms: 0, truncated: false, byBook: [], cancelled: true,
});

export function createSearch() {
  let worker = null;
  let nextId = 1;
  let active = null;

  function ensure() {
    if (worker) return worker;
    worker = new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data }) => {
      if (!active || data.id !== active.id) return;
      if (data.type === 'batch') { active.onBatch(data.rows, data.counts); return; }
      const job = active;
      active = null;
      if (data.type === 'error') job.reject(new Error(data.message));
      else job.resolve(data);
    });
    worker.addEventListener('error', (e) => {
      active?.reject(new Error(`search worker failed: ${e.message}`));
      active = null;
      worker = null;
    });
    return worker;
  }

  return {
    /**
     * @param {{ query: string, translations: string[], books?: number[]|null,
     *           options?: { mode?: string, matchCase?: boolean },
     *           limit?: number,
     *           onBatch: (rows: object[], counts: object) => void }} request
     * @returns {Promise<{ verses:number, chapters:number, books:number, shown:number,
     *                     scanned:number, ms:number, truncated:boolean, byBook:object[] }>}
     */
    run({ query, translations, books = null, options = {}, limit, onBatch }) {
      const id = nextId++;
      if (active) active.resolve(cancelled());
      return new Promise((resolve, reject) => {
        active = { id, onBatch, resolve, reject };
        ensure().postMessage({ id, type: 'search', query, translations, books, options, limit });
      });
    },
    cancel() {
      if (!active) return;
      active.resolve(cancelled());
      active = null;
    },
  };
}
