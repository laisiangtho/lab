/**
 * The scroll fades, and the thing they used to leak.
 *
 * `shell/` is not pure, but this module touches so little of the DOM that
 * standing up the little it touches is cheaper than a browser — and the defect
 * this is here to catch (a listener and two observers per repainted chapter,
 * none of them ever removed, each holding a whole dead chapter alive) is
 * exactly the kind no screenshot and no click would ever show.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

function stubDom() {
  const listeners = new Map();
  const frames = [];
  globalThis.window = {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
  };
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const observed = { size: new Set(), tree: new Set() };
  globalThis.ResizeObserver = class {
    observe(n) { observed.size.add(n); }
    unobserve(n) { observed.size.delete(n); }
    disconnect() { observed.size.clear(); }
  };
  globalThis.MutationObserver = class {
    observe(n) { observed.tree.add(n); }
    disconnect() { observed.tree.clear(); }
  };
  return { listeners, observed, flush: () => { for (const fn of frames.splice(0)) fn(); } };
}

/** A node with just enough of one to be wired. */
function node() {
  const handlers = [];
  return {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 50,
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {} },
    handlers,
    addEventListener: (type, fn) => handlers.push([type, fn]),
    removeEventListener: (type, fn) => {
      const at = handlers.findIndex(([t, f]) => t === type && f === fn);
      if (at >= 0) handlers.splice(at, 1);
    },
  };
}

const rootOf = (nodes) => ({ querySelectorAll: () => nodes });

test('what is watched stays the size of what is on screen', async () => {
  const dom = stubDom();
  const { wireFades, watchedCount } = await import('../app/shell/fade.js');

  let live = [node()];
  wireFades(rootOf(live));
  dom.flush();
  const one = watchedCount();
  assert.equal(one, 1);

  // Two hundred repaints, each replacing the last — which is what reading
  // through a book one chapter at a time does.
  for (let i = 0; i < 200; i += 1) {
    for (const old of live) old.isConnected = false;
    live = [node()];
    wireFades(rootOf(live));
    dom.flush();
  }
  assert.equal(watchedCount(), 1, 'the two hundred behind it were let go');
  assert.equal(dom.observed.size.size, 1);
  assert.equal(dom.observed.tree.size, 1);
  // One resize listener for all of them, rather than one each.
  assert.equal((dom.listeners.get('resize') ?? []).length, 1);
});

test('a node that leaves the document is dropped when it is next looked at', async () => {
  const dom = stubDom();
  const { wireFade, watchedCount } = await import('../app/shell/fade.js');
  const before = watchedCount();
  const gone = node();
  wireFade(gone);
  dom.flush();
  assert.equal(watchedCount(), before + 1);
  assert.equal(gone.handlers.length, 1, 'it listens to its own scrolling');

  gone.isConnected = false;
  for (const [, fn] of gone.handlers) fn();
  dom.flush();
  assert.equal(watchedCount(), before, 'and it takes its listener with it');
  assert.equal(gone.handlers.length, 0);
});
