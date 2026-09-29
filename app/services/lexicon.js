/**
 * Getting a lexicon onto this device, and keeping it there.
 *
 * Modelled on the language packs, and for the same reason: it is a static file
 * in the catalog repository, it is wanted by some readers and not others, and
 * once it is here it should work with the aeroplane mode on. The difference is
 * size — a Strong's dictionary is a megabyte or two, where a language pack is
 * forty lines — which is why it has an object store of its own rather than a
 * place in `records`, which is read whole at startup.
 *
 * Nothing is fetched until a reader presses a Strong's number, and then only
 * the testament that number belongs to. A reader of the Hebrew scriptures never
 * downloads the Greek.
 */

import { parseLexicon, TESTAMENTS } from '../core/lexicon.js';
import { fetchJson } from './library.js';

export function createLexicons({ store, config }) {
  const events = new EventTarget();
  /** What is in memory now: testament letter → parsed lexicon. */
  const held = new Map();
  /** Fetches in flight, so two presses do not make two requests. */
  const going = new Map();

  const urlFor = (testament) => config.lexiconUrl.replace('{code}', testament.toLowerCase());

  /** Whatever is already on this device, read once at startup. */
  async function load() {
    for (const testament of TESTAMENTS) {
      try {
        const stored = await store.getLexicon(testament);
        if (stored) held.set(testament, stored);
      } catch {
        // A lexicon that cannot be read is a lexicon this reader does not have.
      }
    }
    emit();
  }

  /**
   * Fetch one testament's lexicon and keep it.
   *
   * @param {'H'|'G'} testament
   */
  async function install(testament) {
    const which = String(testament).toUpperCase();
    if (!TESTAMENTS.includes(which)) throw new Error(`lexicon: no such testament "${testament}"`);
    if (held.has(which)) return held.get(which);
    if (going.has(which)) return going.get(which);

    const job = (async () => {
      const url = urlFor(which);
      const raw = await fetchJson(url, `${which} lexicon`, { cache: 'no-cache' });
      const parsed = parseLexicon(raw, { source: url.split('/').pop() });
      if (parsed.testament !== which) {
        throw new Error(`${url}: this is the ${parsed.testament} lexicon, not the ${which} one`);
      }
      await store.putLexicon(which, parsed, { bytes: JSON.stringify(raw).length, name: parsed.name });
      held.set(which, parsed);
      emit();
      return parsed;
    })();
    going.set(which, job);
    try {
      return await job;
    } finally {
      going.delete(which);
    }
  }

  async function remove(testament) {
    const which = String(testament).toUpperCase();
    await store.removeLexicon(which);
    held.delete(which);
    emit();
  }

  const emit = () => events.dispatchEvent(new CustomEvent('change'));

  return {
    load,
    install,
    remove,
    /** What a lookup needs: the lexicons in memory, by testament. */
    get held() { return Object.fromEntries(held); },
    has: (testament) => held.has(String(testament).toUpperCase()),
    /** Whether one is being fetched now, for a popover that should say so. */
    fetching: (testament) => going.has(String(testament).toUpperCase()),
    list: () => store.lexicons(),
    on: (type, fn) => { events.addEventListener(type, fn); return () => events.removeEventListener(type, fn); },
  };
}
