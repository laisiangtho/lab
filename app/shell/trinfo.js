/**
 * What a translation is: its name, its language, who published it and under
 * what terms.
 *
 * This belongs nowhere permanent. A copyright line pinned above or below the
 * text is read once and then read past forever, while it costs a strip of the
 * screen on every chapter — so it lives behind the button at the end of the
 * crumb bar, where it is one press away from the text it describes and absent
 * the rest of the time.
 *
 * The catalog knows a little the file does not (the version the catalog lists,
 * when it was installed); the file knows the rest. Both are shown, and nothing
 * is invented: a field the data does not carry is simply not a row.
 */

import { formatBytes, h } from './dom.js';
import { wireFades } from './fade.js';
import { icon } from './icons.js';
import { L, when } from './i18n.js';
import { downloadJson } from '../services/transfer.js';
import { editionCodes } from '../core/strongs.js';

export function createTranslationInfo(ctx) {
  const body = h('div', { class: 'tri-body' });
  // The actions sit outside the scrolling part: a row of controls that slides
  // away under a faded edge is a row nobody can rely on finding.
  const acts = h('div', { class: 'tri-acts' });
  const element = h('div', { class: 'popover trinfo has-arrow', role: 'dialog', hidden: true }, body, acts);
  let anchor = null;

  document.addEventListener('pointerdown', (e) => {
    if (element.hidden || element.contains(e.target) || anchor?.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => { if (!element.hidden && e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (!element.hidden) place(); });

  function close() {
    element.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');
    anchor = null;
  }

  async function open(from, meta) {
    if (anchor === from && !element.hidden) { close(); return; }
    anchor = from;
    from.setAttribute('aria-expanded', 'true');
    const built = await rows(meta);
    body.replaceChildren(...built.filter((node) => node !== null && !node.classList?.contains('tri-acts')));
    acts.replaceChildren(...(built.find((node) => node?.classList?.contains('tri-acts'))?.childNodes ?? []));
    element.hidden = false;
    place();
    // The box hides its scrollbar, so the only thing that can say there is
    // more is the edge itself — measured once it has a size.
    wireFades(element);
  }

  async function rows(meta) {
    const info = meta.info;
    const installed = (await ctx.store.list()).find((t) => t.identify === meta.identify);
    const entry = ctx.library.catalog?.get(meta.identify) ?? null;
    const pack = ctx.langPacks.forMeta(meta);

    const out = [
      h('div', { class: 'tri-head' },
        h('div', { class: 'tri-name', lang: info.language.code, dir: info.language.textdirection }, info.name),
        h('div', { class: 'tri-sub' }, [info.shortname, info.year].filter(Boolean).join(' · '))),
    ];
    if (info.description) out.push(h('p', { class: 'tri-desc' }, info.description));

    const facts = h('dl', { class: 'tri-facts' });
    const row = (term, value) => { if (value) facts.append(h('dt', {}, term), h('dd', {}, value)); };
    row(L('lbl.language'), [info.language.text, pack ? pack.code : info.language.name].filter(Boolean).join(' · '));
    row(L('lbl.publisher'), info.publisher);
    // Not in the facts grid: a KJV licence runs to several paragraphs, and in a
    // narrow right-hand column it turns the popover into a scrolling wall.
    const licence = info.copyright;
    row(L('lbl.version'), entry && entry.version !== meta.version
      ? L('lbl.versionBehind', { held: meta.version, listed: entry.version })
      : String(meta.version));
    row(L('lbl.installedOn'), installed?.installedAt ? when.date(installed.installedAt) : '');
    row(L('lbl.size'), installed?.bytes ? formatBytes(installed.bytes) : '');
    const stats = installed?.stats;
    if (stats) {
      row(L('lbl.strongs'), stats.strongs?.words ? L('lbl.strongsWords', { n: stats.strongs.words }) : '');
      row(L('lbl.contents'), L('lbl.contentsOf', {
        books: L('lbl.books', { n: stats.books }),
        chapters: L('lbl.chapters', { n: stats.chapters }),
        verses: L('lbl.verses', { n: stats.verses }),
      }));
    }
    // What the install found when it checked the file against the canon. Every
    // published translation departs from it somewhere — books it omits, verses
    // counted differently — and a reader who finds a chapter short deserves to
    // see that it is the edition, not a fault in the download.
    const found = installed?.diagnostics ?? null;
    if (found) {
      row(L('lbl.differences'), found.total === 0 ? L('lbl.matchesCanon') : [
        found.missing ? L('lbl.booksMissing', { n: found.missing }) : '',
        found.short ? L('lbl.chaptersShort', { n: found.short }) : '',
        found.extra ? L('lbl.chaptersExtra', { n: found.extra }) : '',
      ].filter(Boolean).join(' · ') || L('lbl.differs', { n: found.total }));
      // What was laid over the master, and where it came from: a draft says
      // so, and its sources are named (they ask to be).
      for (const [kind, one] of Object.entries(installed?.overlays ?? {})) {
        row(L(`lib.ov.${kind}`), [
          one.review ? L('lib.ov.draft') : '', one.method, ...one.sources,
          one.refused ? L('msg.ovRefused', { n: one.refused, name: meta.info.shortname }) : '',
        ].filter(Boolean).join(' · '));
      }
      const faults = Object.entries(found.faults ?? {});
      if (faults.length) row(L('lib.faults'), faults.map(([kind, n]) => L(`lib.faults.${kind}`, { n })).join('; '));
    }
    if (facts.children.length) out.push(facts);
    // A sentence, not a cell: in a narrow popover a grid cell this long is a
    // column one word wide.
    const own = strongsEdition(stats);
    if (own) out.push(h('p', { class: 'tri-note' }, own));
    if (licence) out.push(longBlock(L('lbl.copyright'), licence));
    if (found?.total) out.push(diagnostics(meta, found));

    out.push(direction(meta));

    const link = info.url || entry?.url || '';
    /** A row of glyphs: the names are long, the box is 420px, and these three
        are the same three every time — a strip of words to read past. */
    const act = (glyph, label, run, extra = '') => h('button', {
      class: `tri-act${extra ? ` ${extra}` : ''}`, title: label, 'aria-label': label, onclick: run,
    }, icon(glyph));

    out.push(h('div', { class: 'tri-acts' },
      link
        ? h('a', {
          class: 'tri-act', href: link, target: '_blank', rel: 'noopener noreferrer',
          title: L('cmd.openSource'), 'aria-label': L('cmd.openSource'),
        }, icon('link'))
        : null,
      // A translation file can be corrected upstream without the catalog's
      // version changing, and an installed copy would never hear about it.
      act('undo', L('cmd.refreshTranslation'), () => { close(); ctx.shell.repairTranslation(meta.identify); }),
      // This popover is the summary; the counts above it are the part nobody
      // can act on from here. The report is where they turn into places.
      ctx.registry.hasCommand('report.open')
        ? act('inspector', L('doc.report'), () => {
          close();
          ctx.state.set({ reportFor: meta.identify });
          ctx.shell.openDoc('report');
        })
        : null,
      act('library', L('doc.library'), () => { close(); ctx.shell.openDoc('library'); })));
    return out;
  }

  /**
   * Which way the text runs. The file says, and usually says correctly; when it
   * does not, the reader can say otherwise and the correction is kept with this
   * translation rather than applied to everything they read.
   */
  function direction(meta) {
    const info = meta.info;
    const current = ctx.shell.textDirection(meta.identify);
    const choose = (value) => { ctx.shell.setTextDirection(meta.identify, value); close(); };
    const option = (value, label) => h('button', {
      'aria-pressed': String((current ?? null) === value),
      onclick: () => choose(value),
    }, label);
    return h('div', { class: 'tri-dir' },
      h('span', { class: 'tri-dir-label' }, L('lbl.direction')),
      h('div', { class: 'rp-seg' },
        option(null, L('val.asFiled', { dir: info.language.textdirection.toUpperCase() })),
        option('ltr', 'LTR'),
        option('rtl', 'RTL')));
  }

  /**
   * A paragraph somebody wrote for lawyers, shown without letting it take the
   * whole box: six lines, then a press for the rest.
   */
  function longBlock(term, value) {
    const text = h('p', { class: 'tri-long' }, value);
    const more = h('button', {
      class: 'link-btn tri-long-more',
      onclick: (e) => {
        const open = text.classList.toggle('is-open');
        e.currentTarget.textContent = L(open ? 'lbl.showLess' : 'lbl.showAll');
        place();
      },
    }, L('lbl.showAll'));
    const block = h('div', { class: 'tri-block' }, h('div', { class: 'tri-term' }, term), text);
    // Only offer the press when there is something behind it.
    requestAnimationFrame(() => {
      if (text.scrollHeight > text.clientHeight + 2) block.append(more);
    });
    return block;
  }

  /** The list of departures from the canon, folded away, and the whole of it as a file. */
  function diagnostics(meta, found) {
    const shown = found.items.slice(0, 12);
    const list = h('ul', { class: 'tri-diag' }, ...shown.map((d) => h('li', {}, describe(d))));
    if (found.total > shown.length) list.append(h('li', { class: 'is-more' }, L('diag.more', { n: found.total - shown.length })));
    return h('details', { class: 'tri-more' },
      h('summary', {}, L('lbl.showReport')),
      // What the canon is, said once, where somebody is looking at a number
      // they did not expect.
      h('p', { class: 'tri-why' }, L('lbl.canonWhat')),
      list,
      h('button', { class: 'btn', onclick: () => saveReport(meta, found) }, icon('download'), L('cmd.saveReport')));
  }

  function describe(d) {
    const book = ctx.category.hasBook(d.book) ? ctx.category.book(d.book).name : String(d.book);
    return L(`diag.${d.type}`, { book, chapter: d.chapter, verse: d.verse, expected: d.expected, actual: d.actual });
  }

  function saveReport(meta, found) {
    downloadJson(`${meta.identify}-canon-report.json`, {
      translation: meta.identify, name: meta.info.name, version: meta.version,
      generated: new Date().toISOString(),
      total: found.total, kept: found.items.length, items: found.items,
    });
    ctx.shell.notify(L('msg.reportSaved', { name: meta.info.shortname }));
  }

  function place() {
    if (!anchor || element.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const width = element.offsetWidth;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 10), window.innerWidth - width - 10);
    const above = rect.top > element.offsetHeight + 20 && rect.bottom > window.innerHeight - element.offsetHeight - 20;
    element.classList.toggle('is-above', above);
    element.style.left = `${left}px`;
    element.style.top = `${above ? rect.top - element.offsetHeight - 10 : rect.bottom + 10}px`;
    element.style.setProperty('--arrow-x', `${Math.min(Math.max(rect.left + rect.width / 2 - left, 16), width - 16)}px`);
  }

  return { element, open, close };
}


/**
 * What a translation's Strong's numbers amount to, in a line: how many words
 * carry one, and any numbers the edition uses past the end of the lexicon
 * (eBible.org's tagged Judson marks particles H9999). Empty for a translation
 * without them, and for one installed before they were counted.
 */
export function strongsLine(stats) {
  const tally = stats?.strongs;
  if (!tally) return '';
  return [tally.words ? `${L('lbl.strongs')}: ${L('lbl.strongsWords', { n: tally.words })}` : '', strongsEdition(stats)]
    .filter(Boolean).join(' · ');
}

/** The edition's own numbers, as a sentence; empty when it has none. */
export function strongsEdition(stats) {
  const tally = stats?.strongs;
  const own = editionCodes(tally);
  if (!own.length) return '';
  const codes = own.map(([code, n]) => `${code} ×${n}`).join(', ');
  return L('lbl.strongsEdition', { n: Object.keys(tally.edition).length, codes });
}
