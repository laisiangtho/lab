/**
 * The Reference pane: dictionary articles and topical indexes the reader
 * imported, searched, read, and followed into the text.
 *
 *   header    Dictionary | Topics, and a search field
 *   list      the terms that match; with no search, under Topics, the
 *             subjects the chapter being read is filed under
 *   article   one entry: a dictionary's paragraphs with their verses as
 *             links, or a topic's verses
 *
 * A verse in an article is a link like any other in the app: pressed it
 * opens, hovered it peeks. Nothing is fetched; what is not on the device is
 * said so, with the way to the Library's Study data page.
 */

import { refOf, refText, termKey } from '../../core/studydata.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { wireRef } from '../../shell/reflink.js';

/** Terms listed for a search; a longer search narrows it. */
const LIST_AT_ONCE = 80;
/** A topic's verses listed at once; the rest are a press away. */
const REFS_AT_ONCE = 60;

export function mountReference(el, ctx) {
  const { shell, state } = ctx;
  let mode = 'dictionary';
  let query = '';
  /** The entry being read, or null for the list. */
  let open = null;
  /** Bumped by every paint, so a slow answer for an old search is dropped. */
  let turn = 0;
  let chapterSeen = '';

  const input = h('input', {
    class: 'rf-q', type: 'search', placeholder: L('rf.search'), 'aria-label': L('rf.search'),
    oninput: () => { query = input.value; open = null; paint(); },
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      // Enter opens the first match: "define" and go.
      body.querySelector('.rf-term')?.click();
    },
  });
  const tabs = h('div', { class: 'rf-tabs', role: 'tablist' });
  const body = h('div', { class: 'rf-body' });
  const root = h('div', { class: 'rf ws' }, h('div', { class: 'rf-head' }, tabs, h('div', { class: 'field rf-find' }, icon('search'), input)), body);
  fill(el, root);

  const note = (text, ...more) => h('p', { class: 'ws-note' }, text, ...more);
  const name = (book) => shell.workspace.bookName(book);
  const digits = (n) => shell.workspace.number(n);
  const refLink = (ref) => wireRef(
    h('button', { class: 'ws-ref', dir: 'auto', title: L('peek.hint') }, refText(ref, name(ref[0]), digits)),
    refOf(ref),
    {
      open: (r) => (r.verse ? shell.openVerse(r.book, r.chapter, r.verse) : shell.openChapter(r.book, r.chapter)),
      peek: (r, anchor) => shell.openPeek(anchor, r),
    },
  );
  const toLibrary = () => h('div', { class: 'ws-row' }, h('button', {
    class: 'btn soft', onclick: () => shell.run('library.study'),
  }, icon('library'), L('rf.toLibrary')));

  function paintTabs() {
    fill(tabs, ...['dictionary', 'topics'].map((id) => h('button', {
      class: 'rf-tab', role: 'tab', dataset: { mode: id }, 'aria-selected': String(mode === id),
      onclick: () => { if (mode !== id) { mode = id; open = null; query = ''; input.value = ''; paint(); } },
    }, icon(id === 'dictionary' ? 'book-open' : 'tag'), L(`sd.type.${id}`))));
  }

  async function paint() {
    const mine = ++turn;
    const live = () => mine === turn && root.isConnected;
    paintTabs();
    const sets = (await ctx.study.list()).filter((set) => set.type === mode);
    if (!live()) return;
    if (!sets.length) {
      input.disabled = true;
      fill(body, h('div', { class: 'ws-empty' }, icon(mode === 'dictionary' ? 'book-open' : 'tag'),
        h('p', {}, L(mode === 'dictionary' ? 'rf.noDictionary' : 'rf.noTopics'))), toLibrary());
      return;
    }
    input.disabled = false;
    if (open) { paintEntry(open, sets); return; }
    const all = mode === 'dictionary' ? await ctx.study.dictionary() : await ctx.study.topics();
    if (!live()) return;
    const q = termKey(query);
    if (!q && mode === 'topics') { await paintChapterTopics(live); return; }
    if (!q) {
      fill(body, note(L('rf.held', { n: all.length, sets: sets.map((set) => set.name).join(', ') })));
      return;
    }
    // Terms that begin with the search first, then those that hold it.
    const starts = [];
    const holds = [];
    for (const entry of all) {
      const key = termKey(entry.term);
      if (key.startsWith(q)) starts.push(entry);
      else if (key.includes(q)) holds.push(entry);
    }
    const found = [...starts, ...holds];
    if (!found.length) { fill(body, note(L('rf.none', { query: query.trim() }))); return; }
    fill(body,
      note(L('rf.found', { n: found.length })),
      h('ul', { class: 'rf-list' }, found.slice(0, LIST_AT_ONCE).map((entry) => termItem(entry, sets))),
      found.length > LIST_AT_ONCE ? note(L('rf.narrow', { n: found.length - LIST_AT_ONCE })) : null);
  }

  function termItem(entry, sets, extra = null) {
    const set = sets.find((s) => s.id === entry.set);
    return h('li', {}, h('button', {
      class: 'rf-term', dataset: { term: entry.term },
      onclick: () => { open = entry; paint(); },
    },
    h('span', { class: 'rf-term-t' }, entry.term),
    extra ?? (sets.length > 1 && set ? h('span', { class: 'rf-term-s' }, set.name) : null),
    mode === 'topics' && !extra ? h('span', { class: 'rf-term-s' }, digits(entry.refs?.length ?? 0)) : null));
  }

  async function paintChapterTopics(live) {
    const { book, chapter } = state.get();
    chapterSeen = `${book}.${chapter}`;
    const found = await ctx.study.topicsIn(book, chapter);
    if (!live()) return;
    const sets = (await ctx.study.list()).filter((set) => set.type === 'topics');
    const where = `${name(book)} ${digits(chapter)}`;
    if (!found.length) { fill(body, note(L('rf.chapterNone', { where }))); return; }
    fill(body,
      note(L('rf.inChapter', { where, n: found.length })),
      h('ul', { class: 'rf-list' }, found.slice(0, LIST_AT_ONCE).map(({ entry, verses }) => termItem(entry, sets,
        h('span', { class: 'rf-term-s' }, verses.length > 4
          ? `${digits(verses[0])}–${digits(verses.at(-1))} (${digits(verses.length)})`
          : verses.map(digits).join(', '))))));
  }

  function paintEntry(entry, sets) {
    const set = sets.find((s) => s.id === entry.set);
    const back = h('button', {
      class: 'rf-back', onclick: () => { open = null; paint(); },
    }, icon('arrow-left'), L('rf.back'));
    const head = h('header', { class: 'rf-entry-head' },
      h('h2', { class: 'rf-entry-t' }, entry.term),
      set ? h('p', { class: 'ws-src' }, [set.name, set.licence].filter(Boolean).join(' · ')) : null);
    if (mode === 'dictionary') {
      const paragraphs = Array.isArray(entry.body) ? entry.body : String(entry.body ?? '').split(/\n{2,}/).map((text) => [text]);
      fill(body, back, head, h('div', { class: 'rf-article' }, paragraphs.map((para) => h('p', {},
        (Array.isArray(para) ? para : [para]).map((seg) => (typeof seg === 'string' ? seg : refLink(seg.r)))))));
      return;
    }
    const refs = entry.refs ?? [];
    const list = h('div', { class: 'ws-refs rf-refs' });
    let shown = 0;
    const more = () => {
      list.querySelector('.ws-more')?.remove();
      const batch = refs.slice(shown, shown + REFS_AT_ONCE);
      shown += batch.length;
      list.append(...batch.map(refLink));
      if (shown < refs.length) list.append(h('button', { class: 'ws-ref ws-more', onclick: more }, L('ws.more', { n: refs.length - shown })));
    };
    more();
    fill(body, back, head,
      entry.note ? h('p', { class: 'rf-topic-note' }, entry.note) : null,
      note(L('lbl.verses', { n: refs.length })),
      list);
  }

  async function show(target) {
    if (target) {
      mode = target.mode ?? mode;
      query = target.query ?? '';
      input.value = query;
      open = null;
      // "define grace" lands on the article when there is one by that name.
      if (target.open && query) {
        const all = mode === 'dictionary' ? await ctx.study.dictionary() : await ctx.study.topics();
        const key = termKey(query);
        open = all.find((entry) => termKey(entry.term) === key) ?? null;
      }
    }
    await paint();
  }

  const offStudy = ctx.study.on('change', () => { open = null; paint(); });
  // Under Topics with no search, the list is the chapter's: it follows the reading.
  const offState = state.subscribe((value) => {
    if (mode === 'topics' && !open && !termKey(query) && `${value.book}.${value.chapter}` !== chapterSeen) paint();
  });
  return {
    show: (target) => show(target).catch((err) => fill(body, note(err.message))),
    dispose: () => { turn += 1; offStudy(); offState(); },
  };
}
