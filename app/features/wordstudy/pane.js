/**
 * The word study pane: what this device holds about one Strong's number.
 *
 *   header        the number, and the lexicon's word, transliteration and part
 *   in this verse the original-language word the number stands for, in the
 *                 verse the reader pressed, its morphology written out, and the
 *                 original verse under it with the word marked
 *   lexicon       the entry, or how to get one
 *   this text     every word the translation uses for the number, most used
 *                 first, each with its verses
 *
 * Each section says plainly what is missing and where it comes from, rather
 * than leaving a gap: an original is only what the reader imported, a lexicon
 * is fetched or imported, and a translation without Strong's numbers has no
 * renderings to gather.
 */

import { lookup } from '../../core/lexicon.js';
import { parseRef, renderings, sameNumber } from '../../core/lemmas.js';
import { describeMorph } from '../../core/morph.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

/** Verses listed at once under a word; the rest are a press away. */
const REFS_AT_ONCE = 60;

let tables = null;
const morphTables = () => (tables ??= import('../../core/morph-data.js'));

export function mountStudy(el, ctx) {
  const { shell } = ctx;
  const root = h('div', { class: 'ws' });
  fill(el, root);
  let target = null;
  /** Bumped by every show, so a slow answer for an old word is dropped. */
  let turn = 0;

  const section = (title, ...body) => h('section', { class: 'ws-sec' }, h('h3', { class: 'ws-h' }, title), ...body);
  const note = (text, ...more) => h('p', { class: 'ws-note' }, text, ...more);
  const pending = () => h('p', { class: 'ws-note ws-wait' }, L('ws.gathering'));
  const refLabel = ({ book, chapter, verse }) => shell.workspace.refLabel(book, chapter, verse);
  const goTo = (ref) => {
    const { book, chapter, verse } = typeof ref === 'string' ? parseRef(ref) : ref;
    shell.openVerse(book, chapter, verse);
  };

  async function show(next) {
    target = next ?? target;
    const mine = ++turn;
    const live = () => mine === turn;
    if (!target?.code) {
      fill(root, h('div', { class: 'ws-empty' },
        icon('study'),
        h('p', {}, L('ws.empty'))));
      return;
    }
    const { code } = target;
    const testament = code[0];

    const head = h('header', { class: 'ws-head' });
    const original = h('div', {}, pending());
    const lexicon = h('div');
    const words = h('div', {}, pending());
    fill(root, head,
      section(L('ws.original'), original),
      section(L('ws.lexicon'), lexicon),
      section(L('ws.renderings'), words));

    paintLexicon(head, lexicon, code);

    // The two slow parts run side by side; each fills its own section.
    paintOriginal(original, target, testament, live).catch((err) => {
      if (live()) fill(original, note(err.message));
    });
    paintRenderings(words, target, live).catch((err) => {
      if (live()) fill(words, note(err.message));
    });
  }

  function paintLexicon(head, into, code) {
    const found = lookup(ctx.lexicons?.held ?? {}, code);
    const entry = found.entry;
    const dir = code[0] === 'H' ? 'rtl' : 'ltr';
    const lang = code[0] === 'H' ? 'hbo' : 'grc';
    fill(head,
      h('div', { class: 'ws-code' }, code),
      entry?.lemma ? h('div', { class: 'ws-lemma', dir, lang }, entry.lemma) : null,
      entry && (entry.translit || entry.pronounce)
        ? h('div', { class: 'ws-say' }, [entry.translit, entry.pronounce].filter(Boolean).join(' · '))
        : null,
      entry?.gloss ? h('div', { class: 'ws-gloss' }, entry.gloss) : null,
      entry?.part ? h('div', { class: 'ws-part' }, entry.part) : null);
    if (entry) {
      fill(into,
        entry.define ? defineView(entry.define) : null,
        entry.kjv ? h('p', { class: 'ws-kjv' }, h('span', { class: 'ws-label' }, L('ws.kjv')), ' ', entry.kjv) : null,
        !entry.define && !entry.kjv ? note(L('lex.absent')) : null,
        found.senses?.length > 1
          ? note(L('lex.senses', { list: found.senses.map((k) => `${found.testament}${k.toUpperCase()}`).join(', ') }))
          : null);
      dictionaryLink(into, entry);
      return;
    }
    if (found.why === 'missing' || found.why === 'none') {
      const which = found.testament || code[0];
      const get = h('button', {
        class: 'btn soft ws-get',
        disabled: ctx.lexicons?.fetching(which) ? '' : null,
        'aria-busy': ctx.lexicons?.fetching(which) ? 'true' : null,
        onclick: (event) => {
          event.currentTarget.disabled = true;
          event.currentTarget.textContent = L('lex.fetching');
          ctx.lexicons.install(which).catch((err) => fill(into, note(err.message)));
        },
      }, icon('download'), ctx.lexicons?.fetching(which) ? L('lex.fetching') : L('lex.get', { which: L(`lex.${which}`) }));
      fill(into,
        note(L('lex.notHere', { which: L(`lex.${which}`) })),
        ctx.lexicons ? h('div', { class: 'ws-row' }, get) : null,
        note(L('ws.lexImport')));
      return;
    }
    fill(into, note(L(found.why === 'ambiguous' ? 'lex.ambiguous' : 'lex.absent')));
  }

  /**
   * The imported dictionaries' article on the word, where one has it: by the
   * lexicon's gloss ("God", "grace"), else by the first of the KJV's words for
   * it. A link to the Reference pane, added when found; nothing when not.
   */
  function dictionaryLink(into, entry) {
    if (!ctx.study) return;
    const mine = turn;
    const words = [entry.gloss, ...String(entry.kjv ?? '').replace(/\([^)]*\)/g, '').split(/[,;]/)]
      .map((word) => String(word ?? '').replace(/[^\p{L}\p{N}' -]/gu, '').trim())
      .filter((word) => word && word.length > 1)
      .slice(0, 4);
    (async () => {
      for (const word of words) {
        const hits = await ctx.study.lookup(word);
        if (mine !== turn) return;
        if (!hits.length) continue;
        into.append(h('div', { class: 'ws-row ws-dict' }, h('button', {
          class: 'btn soft',
          onclick: () => ctx.registry.verbs().find((verb) => verb.word === 'define')?.run(hits[0].term),
        }, icon('book-open'), L('ws.inDictionary', { term: hits[0].term }))));
        return;
      }
    })().catch(() => {});
  }

  /** A long entry, folded to its first lines until asked for whole. */
  function defineView(text) {
    const body = h('p', { class: 'ws-define' }, text);
    const long = text.split('\n').length > 7 || text.length > 480;
    if (!long) return body;
    body.classList.add('is-folded');
    const toggle = h('button', {
      class: 'ws-fold',
      'aria-expanded': 'false',
      onclick: () => {
        const open = body.classList.toggle('is-folded') === false;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = L(open ? 'ws.showLess' : 'ws.showAll');
      },
    }, L('ws.showAll'));
    return h('div', {}, body, toggle);
  }

  async function paintOriginal(into, at, testament, live) {
    const source = await ctx.lemmas.original(testament);
    if (!live()) return;
    if (!source) {
      fill(into,
        note(L(testament === 'H' ? 'ws.noHebrew' : 'ws.noGreek')),
        h('div', { class: 'ws-row' }, h('button', {
          class: 'btn soft',
          onclick: () => shell.run('library.open'),
        }, icon('library'), L('ws.toLibrary'))));
      return;
    }
    const name = source.info?.shortname || source.info?.name || source.identify;
    if (!at.verse) {
      fill(into, note(L('ws.noVerse', { name })));
      return;
    }
    // The verse as the original numbers it: Malachi 4:1 in an English Bible
    // is Hebrew 3:19.
    const from = at.identify ? await ctx.lemmas.numbering(at.identify) : 'english';
    const [{ words, at: read }, morph] = await Promise.all([
      ctx.lemmas.verseWords(source.identify, at.book, at.chapter, at.verse, { from }),
      morphTables(),
    ]);
    if (!live()) return;
    const moved = read.length !== 1 || read[0].chapter !== at.chapter || read[0].verse !== at.verse;
    const where = moved
      ? `${refLabel(at)} = ${read.map((ref) => `${shell.workspace.number(ref.chapter)}:${shell.workspace.number(ref.verse)}`).join(', ')}`
      : refLabel(at);
    if (!words.length) {
      fill(into, note(L('ws.verseMissing', { name, where })));
      return;
    }
    const dir = shell.textDirection?.(source.identify) ?? (testament === 'H' ? 'rtl' : 'ltr');
    const lang = source.info?.language?.name || (testament === 'H' ? 'hbo' : 'grc');
    const hits = [];
    const line = h('p', { class: 'ws-verse', dir, lang });
    words.forEach((word, i) => {
      const slot = word.codes.findIndex((c) => sameNumber(c, target.code));
      const hit = slot >= 0;
      if (hit) hits.push({ word, morph: word.morphs[slot] ?? null });
      if (i) line.append(' ');
      line.append(h('span', { class: hit ? 'ws-hit' : null }, word.word));
    });
    const caption = h('p', { class: 'ws-src' }, h('button', {
      class: 'ws-ref', dir: 'auto', onclick: () => goTo(at),
    }, where), ' · ', h('bdi', {}, name));
    if (!hits.length) {
      fill(into, caption, line, note(L('ws.notInVerse', { code: target.code })));
      return;
    }
    fill(into, caption,
      ...hits.map(({ word, morph: code }) => h('div', { class: 'ws-word' },
        h('div', { class: 'ws-orig', dir, lang }, word.word),
        code ? morphView(code, morph) : h('div', { class: 'ws-morph' }, L('ws.noMorph')))),
      line);
  }

  function morphView(code, morph) {
    const { parts } = describeMorph(code, morph);
    const read = parts.some((part) => part.said);
    return h('div', { class: 'ws-morph' },
      h('code', { class: 'ws-mcode' }, code),
      read
        ? h('ul', { class: 'ws-parts' }, ...parts.map((part) => h('li', {},
          part.said ?? h('span', { class: 'ws-unknown' }, L('ws.unknownPart', { code: part.code })))))
        : h('p', { class: 'ws-note' }, L('ws.morphRaw')));
  }

  async function paintRenderings(into, at, live) {
    if (!at.identify) { fill(into, note(L('ws.noTranslation'))); return; }
    const meta = (await ctx.store.list()).find((row) => row.identify === at.identify);
    if (!live()) return;
    if (!meta) { fill(into, note(L('ws.noTranslation'))); return; }
    const name = meta.info?.shortname || meta.info?.name || meta.identify;
    const index = await ctx.lemmas.index(at.identify);
    if (!live()) return;
    const found = renderings(index, at.code);
    const find = h('button', {
      class: 'btn soft',
      onclick: () => ctx.registry.verbs().find((verb) => verb.word === 'find')?.run(at.code),
    }, icon('search'), L('ws.findAll'));
    if (!found.n) {
      fill(into, note(L(Object.keys(index.codes).length ? 'ws.noRendering' : 'ws.untagged', { code: at.code, name })));
      return;
    }
    const most = found.words[0].n;
    const dir = shell.textDirection?.(at.identify) ?? 'ltr';
    const lang = meta.info?.language?.name || null;
    fill(into,
      note(`${L('ws.counted', { n: found.n, name })} · ${L('ws.forms', { n: found.words.length })}`),
      h('ul', { class: 'ws-list' }, ...found.words.map((word) => {
        const refs = h('div', { class: 'ws-refs' });
        let shown = 0;
        const more = () => {
          const batch = word.refs.slice(shown, shown + REFS_AT_ONCE);
          shown += batch.length;
          refs.querySelector('.ws-more')?.remove();
          refs.append(...batch.map((ref) => h('button', { class: 'ws-ref', dir: 'auto', onclick: () => goTo(ref) }, refLabel(parseRef(ref)))));
          if (shown < word.refs.length) {
            refs.append(h('button', { class: 'ws-ref ws-more', onclick: more },
              L('ws.more', { n: word.refs.length - shown })));
          }
        };
        const box = h('details', {
          class: 'ws-item',
          ontoggle: (event) => { if (event.currentTarget.open && !shown) more(); },
        },
        h('summary', { class: 'ws-sum' },
          h('span', { class: 'ws-word-t', dir, lang }, word.word),
          h('span', { class: 'ws-n' }, shell.workspace.number(word.n)),
          h('span', { class: 'ws-bar', 'aria-hidden': 'true' },
            h('span', { style: { width: `${Math.max(3, Math.round((word.n / most) * 100))}%` } }))),
        refs);
        return h('li', {}, box);
      })),
      h('div', { class: 'ws-row' }, find));
  }

  const offLexicon = ctx.lexicons?.on('change', () => { if (target) show(); });
  const offStudy = ctx.study?.on('change', () => { if (target) show(); });
  show(null);
  return {
    show: (next) => show(next),
    dispose: () => { turn += 1; offLexicon?.(); offStudy?.(); },
  };
}
