/**
 * Service worker registration, and what the app can do with it.
 *
 * A new version never replaces a running one underneath the reader: the fresh
 * worker waits until it is asked to take over, and taking over reloads the page
 * once — every open page of the app, not only the one where the reader said
 * yes, since the new worker deletes the old build's cache and the host no
 * longer has its files. That way a page never mixes assets from two builds.
 *
 * The registration is created before start() so nothing is missed, and what the
 * app needs from it — is an update waiting, tell me when one arrives, take it —
 * is handed over as a plain object with no service worker vocabulary in it.
 */

/** @returns {{ supported: boolean, waiting(): boolean, onReady(fn): void, check(): Promise<boolean>, apply(): void }} */
export function createUpdates() {
  const listeners = new Set();
  let registration = null;
  let waiting = null;
  let reloaded = false;

  if ('serviceWorker' in navigator) {
    // A worker that took over from another while this page was running means
    // the page is out of step with its assets — whichever tab asked for it. One
    // reload puts it right. The first worker ever to arrive takes over a page
    // that had none; nothing is out of step then, and nothing is reloaded.
    let controlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const wasControlled = controlled;
      controlled = true;
      if (!wasControlled || reloaded) return;
      reloaded = true;
      location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        registration = reg;
        found(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const fresh = reg.installing;
          fresh?.addEventListener('statechange', () => {
            // Nothing is controlling the page on a first install; that is not
            // an update, it is the app becoming available offline.
            if (fresh.state === 'installed' && navigator.serviceWorker.controller) found(fresh);
          });
        });
      }, (err) => {
        console.error(`service worker registration failed: ${err.message}`);
      });
    });
  }

  function found(worker) {
    if (!worker || waiting === worker) return;
    waiting = worker;
    for (const fn of listeners) fn();
  }

  return Object.freeze({
    supported: 'serviceWorker' in navigator,
    waiting: () => Boolean(waiting),
    onReady(fn) {
      listeners.add(fn);
      if (waiting) fn();
    },
    /** Ask the server whether there is a newer build. @returns whether one is waiting */
    async check() {
      if (!registration) return Boolean(waiting);
      await registration.update();
      return Boolean(waiting);
    },
    apply() {
      if (!waiting) return;
      waiting.postMessage({ type: 'take-over' });
    },
  });
}

/**
 * The browser's own offer to install the app, held until the reader asks for
 * it. Chromium-based browsers fire this; others install through their own menu,
 * and there the offer simply never becomes available.
 */
export function createInstallOffer() {
  let deferred = null;
  let installed = false;
  const listeners = new Set();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    for (const fn of listeners) fn();
  });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; });

  return Object.freeze({
    available: () => Boolean(deferred),
    onOffer(fn) { listeners.add(fn); if (deferred) fn(); },
    installed: () => installed
      || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches),
    /** @returns {Promise<'accepted'|'dismissed'|'unavailable'>} */
    async prompt() {
      if (!deferred) return 'unavailable';
      const event = deferred;
      deferred = null;
      event.prompt();
      const { outcome } = await event.userChoice;
      return outcome;
    },
  });
}
