/**
 * Scroll fades: a scrollable area that has more above or below says so, by
 * fading its own edge rather than by drawing a line.
 *
 * The stylesheet does the fading from two variables; this sets them. A pane is
 * hidden until its tab is chosen, so it measures zero at wiring time and
 * nothing inside it has changed when it appears — hence the observers rather
 * than a single measurement.
 *
 * ## Why this is a registry rather than a function that wires and walks away
 *
 * The first version added a `window` resize listener, a `ResizeObserver` and a
 * `MutationObserver` per node and offered no way to take them off again. That
 * was survivable for a sidebar pane, which is built once, and not at all for a
 * chapter: `renderPanes` builds a fresh `.leaf-scroll` on every repaint, and
 * the app repaints on every state change — stepping a chapter, changing the
 * theme, toggling a sidebar, saving a note. Each repaint left behind a live
 * listener closing over the chapter it had just replaced, so the detached DOM
 * could never be collected. Reading through a book left a few hundred dead
 * chapters in memory and a few hundred handlers running on every window
 * resize, and on the desktop build the process never restarts to clear it.
 *
 * So the wiring is owned here: one listener and one observer of each kind for
 * the whole app, a set of the nodes they serve, and anything no longer in the
 * document is dropped on the next pass.
 */

/** The nodes being watched, and how to stop watching each. */
const watched = new Map();
let shared = null;

function machinery() {
  if (shared) return shared;
  const resize = new Set();
  // One handler for every node, rather than one per node.
  const onResize = () => { for (const node of watched.keys()) watched.get(node)?.schedule(); };
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

  const observe = (Kind, options) => {
    if (typeof Kind === 'undefined') return null;
    try {
      return new Kind((entries) => {
        for (const entry of entries) watched.get(entry.target)?.schedule();
      }, options);
    } catch {
      return null;
    }
  };
  shared = {
    resize,
    size: observe(typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver),
    // Panes repaint their contents without scrolling, so watch the subtree too.
    tree: observe(typeof MutationObserver === 'undefined' ? undefined : MutationObserver),
  };
  return shared;
}

export function wireFade(node) {
  if (!node || watched.has(node)) return;
  const parts = machinery();

  node.classList.add('fade-scroll');
  let queued = false;
  const update = () => {
    queued = false;
    // A node that has left the document is one nobody can see; letting go of it
    // here is what keeps the set the size of what is on screen.
    if (!node.isConnected) { unwireFade(node); return; }
    const max = node.scrollHeight - node.clientHeight;
    const live = max > 2;
    node.style.setProperty('--fade-top', live && node.scrollTop > 2 ? '20px' : '0px');
    node.style.setProperty('--fade-bottom', live && node.scrollTop < max - 2 ? '26px' : '0px');
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  node.addEventListener('scroll', schedule, { passive: true });
  parts.size?.observe(node);
  parts.tree?.observe(node, { childList: true, subtree: true, characterData: true });
  watched.set(node, { schedule, off: () => node.removeEventListener('scroll', schedule) });
  schedule();
}

/** Stop watching one node. */
export function unwireFade(node) {
  const held = watched.get(node);
  if (!held) return;
  watched.delete(node);
  held.off();
  shared?.size?.unobserve(node);
  // A MutationObserver cannot unobserve one target, so it is rebuilt from what
  // is left — which happens on a repaint, not on a frame, and stays cheap.
  if (shared?.tree) {
    shared.tree.disconnect();
    for (const other of watched.keys()) {
      shared.tree.observe(other, { childList: true, subtree: true, characterData: true });
    }
  }
}

/**
 * Wire every scrollable area inside a root that is not wired yet, and let go of
 * everything that has left the document since the last pass. Callers do not
 * have to remember to unwire: a repaint replaces nodes, and the next pass is
 * what notices.
 */
export function wireFades(root) {
  for (const node of [...watched.keys()]) if (!node.isConnected) unwireFade(node);
  for (const node of root.querySelectorAll('.pane-body, .leaf-scroll, .np-grid, .modal-list, .tri-body')) wireFade(node);
}

/** How many nodes are being watched — for the test that this stops growing. */
export const watchedCount = () => watched.size;
