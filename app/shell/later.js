/**
 * Work held back a moment — typing saved a little after it stops — that is
 * never dropped: it runs early when its holder closes (`flush()`) or when the
 * page goes away (pagehide: a closed tab or window, a reload, a navigation).
 *
 * A pending save that was cancelled instead lost whatever had been typed in
 * the last half second before a pane closed or the window did.
 */

/**
 * @param {number} delay ms after the last `schedule` of a key
 * @returns {{ schedule(key: string, fn: () => unknown): void, flush(key?: string): void, dispose(): void }}
 *   `flush()` with no key runs everything pending; `dispose()` flushes and
 *   stops listening for the page going away.
 */
export function later(delay) {
  /** @type {Map<string, { fn: () => unknown, timer: ReturnType<typeof setTimeout> }>} */
  const pending = new Map();

  function run(key) {
    const job = pending.get(key);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(key);
    job.fn();
  }
  const flushAll = () => { for (const key of [...pending.keys()]) run(key); };
  window.addEventListener('pagehide', flushAll);

  return {
    schedule(key, fn) {
      const job = pending.get(key);
      if (job) clearTimeout(job.timer);
      pending.set(key, { fn, timer: setTimeout(() => run(key), delay) });
    },
    flush(key) {
      if (key === undefined) flushAll();
      else run(key);
    },
    dispose() {
      flushAll();
      window.removeEventListener('pagehide', flushAll);
    },
  };
}
