/**
 * Library: browse the catalog, make translations available offline, update
 * and remove them, and check the remote catalog for changes.
 */

import { describe, FORMATS, sniff, slug } from '../../core/formats/index.js';
import { isBrowserBible } from '../../core/formats/browserbible.js';
import { isStepLexicon } from '../../core/lexicon.js';
import { contentOfStats, featuresOf } from '../../core/content.js';
import { sniffStudy } from '../../core/studydata.js';
import { classify, otherEdition, readMetadata } from '../../core/formats/pack.js';
import { aboutText, lossOf, optionsFor, WRITERS } from '../../core/formats/write.js';
import { twoLetter } from '../../core/langcode.js';
import { onDevice } from '../../core/sources.js';
import { createSources } from '../../services/sources.js';
import { pickFile, saveText } from '../../services/transfer.js';
import { gzipText, makeDeflatedZip, openZip } from '../../services/zip.js';
import { fill, formatBytes, h, keepPlace } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { strongsLine } from '../../shell/trinfo.js';
import { openMenu } from '../../shell/menu.js';
import { currentLocale, L, when } from '../../shell/i18n.js';
import { requestPersistence, storageStatus } from '../../services/store.js';

/** Where Get more can take a translation from, in the order they are offered. */
const SOURCE_IDS = Object.freeze(['catalog', 'getbible', 'ebible', 'url', 'file']);
const SOURCE_ICON = Object.freeze({ catalog: 'library', getbible: 'db', ebible: 'book', url: 'link', file: 'files' });
/**
 * How many rows of a long list are drawn before typing narrows it. eBible.org
 * lists over a thousand translations; drawing them all is seconds of work to
 * show a column nobody scrolls to the bottom of.
 */
const LIST_CAP = 150;
/** The feature record: which source Get more was last on. */
const KEY = 'library';


/** The feature record holding the export dialog's last answers. */
const EXPORT_KEY = 'library.export';

/**
 * Where each kind of study data can be had, as its publisher gives it out.
 * "Get" downloads the file and imports it as if it had been chosen; where a
 * site will not let a web page download from it, the reader is told so and
 * pointed at the page to save the file from.
 */
const STUDY_SOURCES = Object.freeze([
  {
    id: 'openbible', type: 'crossrefs', name: 'OpenBible.info cross-references', licence: 'CC BY 4.0',
    url: 'https://a.openbible.info/data/cross-references.zip', page: 'https://www.openbible.info/labs/cross-references/',
  },
  {
    id: 'nave', type: 'topics', name: 'Nave’s Topical Bible (1896)', licence: 'public domain',
    url: 'https://ccel.org/ccel/n/nave/bible.xml', page: 'https://ccel.org/ccel/nave/bible',
  },
  {
    id: 'easton', type: 'dictionary', name: 'Easton’s Bible Dictionary (1897)', licence: 'public domain',
    url: 'https://ccel.org/ccel/e/easton/ebd2.xml', page: 'https://ccel.org/ccel/easton/ebd2',
  },
]);
const STUDY_TYPES = Object.freeze(['crossrefs', 'topics', 'dictionary']);
const STUDY_ICON = Object.freeze({ crossrefs: 'link', topics: 'tag', dictionary: 'book-open' });
export default {
  id: 'library',
  setup(ctx) {
    const { annotations, category, library, records, registry, shell, state } = ctx;
    const progress = new Map(); // identify -> text
    // The page repaints itself while it is open; an import can be started from
    // the command palette with the page shut, and then there is nothing to
    // repaint and nothing that needs to be.
    let repaint = () => {};
    const saved = records.get(KEY, null);
    const sources = createSources({ store: ctx.store, platform: ctx.platform, config: ctx.config });
    /** The open Library's way to show one source, for commands run from elsewhere. */
    let openSource = null;
    /** Set while the Library is open: shows what is on this device, where a file just added now is. */
    let showHome = null;
    /** The page the Library opens on next, when something asked for one while it was shut. */
    let pendingPage = null;
    /** Show the Study data page — open, or the next time the Library opens. */
    let studyGo = null;
    const showStudy = () => {
      if (studyGo) studyGo();
      else pendingPage = 'study';
      ctx.shell.openDoc('library');
    };

    async function check() {
      try {
        const { changed } = await library.checkForUpdates({ force: true });
        shell.notify(L(changed ? 'lib.catalogChanged' : 'lib.catalogSame'));
      } catch (err) {
        shell.notify(L('lib.catalogFailed', { why: err.message }), 'error');
      }
    }

    /**
     * Ask the browser to keep what is stored when space runs short. It may
     * agree, refuse, or ask the reader; whichever it does is reported.
     */
    async function keep() {
      const granted = await requestPersistence();
      shell.notify(L(granted ? 'lib.kept' : 'lib.notKept'), granted ? 'ok' : 'info');
    }

    async function act(identify, action) {
      // The reader knows the translation by its name, not by the file it is in.
      const name = library.catalog?.get(identify)?.name ?? identify;
      progress.set(identify, L(action === 'remove' ? 'lib.removing' : 'lib.starting'));
      try {
        if (action === 'remove') {
          await library.remove(identify);
          shell.notify(L('lib.removed', { name }));
        } else {
          const result = await library.install(identify);
          // Only what a reader can act on: a catalog that disagrees with the
          // file. How the file differs from the canon belongs with the
          // translation itself, not in a message that disappears.
          const notes = result.versionMismatch
            ? L('lib.versionMismatch', { catalog: result.versionMismatch.catalog, file: result.versionMismatch.file })
            : '';
          shell.notify(notes ? L('lib.installedNoted', { name, notes }) : L('lib.installed', { name }), 'ok', {
            actions: [{ label: L('lib.readIt'), icon: 'book-open', run: () => shell.readTranslation(identify) }],
          });
        }
      } catch (err) {
        shell.notify(`${name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
      }
    }

    /**
     * Bring in a translation the catalog does not carry.
     *
     * The question in the middle — *what is this file?* — is the only part of
     * this worth arguing about, so: it is asked because a file's extension is a
     * poor witness (`.xml` is three formats and `.txt` is any of them), the
     * answer is already filled in from the file's own contents, and getting it
     * wrong costs a press. It is not a gate, it collects nothing, and a reader
     * who accepts every default never types a character.
     *
     * The other three answers exist because most formats cannot carry them. A
     * USFM file knows it is Genesis and has no idea what translation it belongs
     * to; a spreadsheet of verses knows neither.
     */
    async function importFile(given = null) {
      const file = given ?? await pickFile({
        accept: '.zip,.json,.usfm,.sfm,.usfx,.usx,.osis,.xml,.zef,.csv,.tsv,.txt,text/*,application/zip',
      });
      if (!file) return;
      if (/\.zip$/i.test(file.name) || isZip(file.bytes)) { await importArchive(file); return; }
      if (isLexicon(file.text)) { await importLexicon(file); return; }
      if (sniffStudy(file.text)) { await importStudyFile(file, file.studyType ?? null); return; }

      const guesses = sniff(file.text, file.name);
      if (!guesses.length) {
        shell.notify(L('imp.unknown', { file: file.name }), 'error');
        return;
      }
      const best = guesses[0].id;
      const found = describe(file.text, best, file.name);
      /** The format the boxes were last filled for. */
      let describedAs = best;

      const answers = await shell.form({
        title: L('imp.title'),
        lede: L('imp.lede', { file: file.name, size: formatBytes(file.size) }),
        confirm: L('imp.do'),
        fields: [
          {
            id: 'format',
            label: L('imp.format'),
            hint: L('imp.formatHint'),
            type: 'choice',
            value: best,
            options: FORMATS.map((format) => ({
              id: format.id,
              label: L(`imp.fmt.${format.id}`),
              sub: confidenceOf(guesses, format.id),
            })),
          },
          { id: 'name', label: L('imp.name'), value: found.name, placeholder: L('imp.namePh') },
          { id: 'identify', label: L('imp.identify'), hint: L('imp.identifyHint'), value: found.identify },
          { id: 'language', label: L('imp.language'), hint: L('imp.languageHint'), value: found.language },
        ],
        // Choosing a different format re-reads the file for what that format
        // says about itself, so the boxes agree with the answer above them.
        // Only then: this runs after every answer, and re-reading on a
        // keystroke put the file's guess back over what was being typed —
        // the boxes looked disabled.
        onChange: (values, set) => {
          if (values.format === describedAs) return;
          describedAs = values.format;
          const again = describe(file.text, values.format, file.name);
          set('name', again.name);
          set('identify', again.identify);
          set('language', again.language);
        },
      });
      if (!answers) return;

      const identify = slug(answers.identify || answers.name || file.name);
      progress.set(identify, L('lib.starting'));
      repaint();
      try {
        const result = await library.importTranslation({
          text: file.text,
          format: answers.format,
          identify,
          info: { name: answers.name, language: answers.language, source: file.name },
        });
        const notes = [
          `${L('lbl.books', { n: result.stats.books })}, ${L('lbl.verses', { n: result.stats.verses })}`,
          strongsLine(result.stats),
          result.diagnostics.length ? L('lbl.differs', { n: result.diagnostics.length }) : '',
          result.report?.notes ? L('imp.notesDropped', { n: result.report.notes }) : '',
          result.report?.skipped ? L('imp.skipped', { n: result.report.skipped }) : '',
        ].filter(Boolean).join(' · ');
        shell.notify(L('imp.done', { name: answers.name || identify, notes }), 'ok', { actions: [{ label: L('lib.readIt'), icon: 'book-open', run: () => shell.readTranslation(identify) }] });
        showHome?.();
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
        repaint();
      }
    }

    /** A lexicon file: STEPBible's TBESH/TBESG, or this app's own JSON lexicon. */
    function isLexicon(text) {
      if (isStepLexicon(text)) return true;
      if (!/^\s*\{/.test(text ?? '')) return false;
      return /"kind"\s*:\s*"lexicon"/.test(String(text).slice(0, 400));
    }

    async function importLexicon(file) {
      if (!ctx.lexicons) throw new Error(L('lex.unavailable'));
      try {
        const lex = await ctx.lexicons.adopt(file.text, file.name);
        shell.notify(L('lex.adopted', {
          name: lex.name, n: Object.keys(lex.entries).length, testament: L(lex.testament === 'H' ? 'lex.hebrew' : 'lex.greek'),
        }), 'ok');
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
      }
    }

    /**
     * Study data: cross-references, a topical index, a dictionary
     * (core/studydata.js). A ThML reference work can be read either as a
     * dictionary or as a topical index, so the reader is asked which, with
     * the work's own title to go on; the other formats say what they are.
     */
    async function importStudyFile(file, studyType = null) {
      if (!ctx.study) { shell.notify(L('sd.unavailable'), 'error'); return; }
      const found = sniffStudy(file.text);
      let type = studyType ?? found?.type ?? null;
      if (!type && found?.format === 'thml') {
        const title = /<DC\.Title>([\s\S]*?)<\/DC\.Title>/.exec(file.text)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? file.name;
        const answers = await shell.form({
          title: L('sd.readAs'),
          lede: L('sd.readAsLede', { file: title }),
          confirm: L('imp.do'),
          fields: [{
            id: 'type', label: L('sd.readAsField'), type: 'choice',
            value: /topic/i.test(title) ? 'topics' : 'dictionary',
            options: ['dictionary', 'topics'].map((id) => ({ id, label: L(`sd.type.${id}`), sub: L(`sd.typeHint.${id}`) })),
          }],
        });
        if (!answers) return;
        type = answers.type;
      }
      progress.set(`study:${file.name}`, L('lib.converting'));
      shell.notify(L('sd.importing', { name: file.name }), 'info', { about: `study:${file.name}` });
      try {
        const meta = await ctx.study.importFile({ text: file.text, name: file.name, studyType: type });
        shell.notify(L('sd.imported', { name: meta.name, n: meta.count, kind: L(`sd.type.${meta.type}`) }), 'ok', {
          about: `study:${file.name}`,
          actions: meta.type === 'crossrefs' ? [] : [{
            label: L('sd.show'), icon: meta.type === 'topics' ? 'tag' : 'book-open',
            run: () => ctx.registry.verbs().find((verb) => verb.word === (meta.type === 'topics' ? 'topic' : 'define'))?.run(''),
          }],
        });
        showStudy?.();
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error', { about: `study:${file.name}` });
      } finally {
        progress.delete(`study:${file.name}`);
        repaint?.();
      }
    }

    /**
     * A published bundle, as a zip.
     *
     * This is how a translation actually arrives — `engkjvcpb_usfx.zip` from
     * eBible.org is the scripture, the translation's own book names, its
     * metadata and its copyright notice, in one download. Taking the whole
     * archive means the import knows what the translation is called and what it
     * calls Genesis, instead of asking a reader who would have to go and look.
     */
    async function importArchive(file) {
      let files;
      let entries;
      try {
        ({ files, entries } = await readArchive(file.bytes, file.name));
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
        return;
      }

      // OpenBible.info's cross-references come as a zip of one text file.
      const study = classify(files).scripture.length ? null : files.find((f) => sniffStudy(f.text));
      if (study) { await importStudyFile({ ...study, size: study.text.length }, file.studyType ?? null); return; }

      // A download from eBible.org that is not the data: say which one is.
      const other = classify(files).scripture.length ? null : otherEdition(files, file.name);
      if (other) {
        shell.notify(L(`imp.edition.${other.kind}`, { file: file.name, instead: other.instead }), 'error');
        return;
      }

      const found = packDescribe(files, file.name);
      const answers = await shell.form({
        title: L('imp.packTitle'),
        lede: L('imp.packLede', {
          file: file.name,
          size: formatBytes(file.size),
          n: entries.length,
          what: found.summary,
        }),
        confirm: L('imp.do'),
        fields: [
          { id: 'name', label: L('imp.name'), value: found.name, placeholder: L('imp.namePh') },
          { id: 'identify', label: L('imp.identify'), hint: L('imp.identifyHint'), value: found.identify },
          { id: 'language', label: L('imp.language'), hint: L('imp.languageHint'), value: found.language },
        ],
      });
      if (!answers) return;

      const identify = slug(answers.identify || answers.name || file.name);
      progress.set(identify, L('lib.starting'));
      repaint();
      try {
        const result = await library.importPack({
          files,
          identify,
          info: { name: answers.name, language: answers.language, source: file.name },
        });
        const report = result.report ?? {};
        const notes = [
          `${L('lbl.books', { n: result.stats.books })}, ${L('lbl.verses', { n: result.stats.verses })}`,
          strongsLine(result.stats),
          report.named ? L('imp.withNames', { n: report.named }) : '',
          result.diagnostics.length ? L('lbl.differs', { n: result.diagnostics.length }) : '',
        ].filter(Boolean).join(' · ');
        shell.notify(L('imp.done', { name: answers.name || identify, notes }), 'ok', { actions: [{ label: L('lib.readIt'), icon: 'book-open', run: () => shell.readTranslation(identify) }] });
        showHome?.();
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
        repaint();
      }
    }

    /**
     * The text files in a zip, as the pack importer takes them. Only text: a
     * bundle carries fonts and signatures too, and inflating a 4 MB font to
     * look at it would be work for nothing.
     */
    async function readArchive(bytes, name) {
      const entries = openZip(bytes);
      const wanted = entries.filter((entry) => entry.size > 0 && entry.size < 80 * 1024 * 1024
        && !/\.(?:ttf|otf|woff2?|png|jpe?g|gif|pdf|zip|epub|mobi)$/i.test(entry.name));
      const files = [];
      for (const entry of wanted) {
        // browserBible's search indexes are derived from the pages beside
        // them and can run to tens of megabytes; their names are enough to
        // say they were there.
        if (/(^|\/)index(lemma)?\//.test(entry.name)) { files.push({ name: entry.name, text: '' }); continue; }
        try {
          files.push({ name: entry.name.split('/').pop(), text: await entry.text() });
        } catch {
          // One unreadable member is not a reason to refuse the archive; the
          // assembler reports what it did not use.
        }
      }
      if (!files.length) throw new Error(L('imp.emptyZip', { file: name }));
      return { files, entries };
    }

    /** The texts of a downloaded zip, for a source that already said what it holds. */
    const archiveTexts = async (bytes, name) => (await readArchive(bytes, name)).files;

    /**
     * What is in this archive, for the dialog — read from the bundle's own
     * metadata where it has any, so the reader confirms rather than types.
     */
    function packDescribe(files, archiveName) {
      if (isBrowserBible(files)) {
        let meta = {};
        try { meta = JSON.parse(files.find((f) => f.name.split('/').pop() === 'info.json').text); } catch { /* the import says what is wrong */ }
        const pages = files.filter((f) => /^[A-Z0-9]{2}\d{1,3}\.html$/.test(f.name.split('/').pop())).length;
        return {
          name: meta.name || meta.nameEnglish || '',
          identify: slug(meta.abbr || meta.id || archiveName),
          language: meta.lang || '',
          summary: L('imp.packBrowserBible', { n: pages, indexes: files.some((f) => /(^|\/)index(lemma)?\//.test(f.name)) ? L('imp.packIndexes') : '' }),
        };
      }
      // The same question the assembler asks, asked the same way: this was
      // counting the copyright notice as a scripture file.
      const { meta, names, scripture } = classify(files);
      const declared = meta ? readMetadata(meta.text) : {};
      const kind = scripture.length ? sniff(scripture[0].text, scripture[0].name)[0].id : null;
      return {
        name: declared.name ?? '',
        identify: slug(declared.identify || declared.shortname || archiveName),
        language: declared.language ?? '',
        summary: scripture.length
          ? L('imp.packFound', {
            n: scripture.length,
            format: kind ? L(`imp.fmt.${kind}`) : '?',
            named: names ? L('imp.packNames') : '',
          })
          : L('imp.packNothing'),
      };
    }

    /** A zip begins "PK\u0003\u0004", whatever it has been renamed to. */
    const isZip = (bytes) => bytes?.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
      && bytes[2] === 0x03 && bytes[3] === 0x04;

    /**
     * Write a translation out, in a format somebody else's software reads.
     *
     * This is the other half of the import, and it is the same machinery run
     * backwards: `core/formats/write.js` emits, and the reader chooses what and
     * how much. The scope exists because "convert my Bible" is rarely the
     * question — it is usually one book for a lesson, or the New Testament for
     * a phone app that cannot hold more.
     *
     * What a format cannot carry is stated before the button, not after the
     * download: a converter that implies a round trip through this app is
     * lossless would be lying.
     */
    async function exportTranslation(identify) {
      const held = (await ctx.store.list()).find((row) => row.identify === identify);
      if (!held) { shell.notify(L('exp.notHeld'), 'error'); return; }
      const name = held.info?.name ?? identify;
      const notes = annotations.allNotes().filter((note) => String(note.text ?? '').trim());
      const saved = exportPrefs();

      // What the translation carries, asked of the worker while the dialog is
      // already open: until it answers, every chip is offered.
      let has = null;
      let setLater = null;
      let latest = null;
      library.probe(identify).then((found) => {
        has = found;
        if (setLater && latest) setLater('live', summary(latest));
      }).catch(() => { /* the chips stay offered; the export itself reports any fault */ });

      const writerOf = (values) => WRITERS.find((w) => w.id === values.format);
      const applies = (values, option) => optionsFor(values.format).includes(option);
      /** How many files the answers produce before any packaging. */
      const fileCount = (values) => {
        const books = booksFor(values, []);
        const count = books ? books.length : category.books.length;
        return writerOf(values)?.single ? 1 : count;
      };
      const carries = (option) => option === 'notes' ? notes.length > 0 : !has || has[option];

      /** What the answers so far add up to, in one line. */
      const summary = (values) => {
        latest = values;
        const books = booksFor(values, []);
        const list = books ?? category.books.map((book) => book.id);
        const chapters = list.reduce((n, id) => n + (category.hasBook(id) ? category.book(id).chapters : 0), 0);
        if (!list.length) return L('exp.summaryNone', { what: String(values.book ?? '').trim() });
        const files = fileCount(values);
        const packed = values.pack === 'zip'
          ? L('exp.filesMany', { n: files + 1 })
          : L('exp.oneFile');
        const all = category.books.reduce((n, book) => n + book.chapters, 0);
        const bytes = estimate(held.bytes ?? 0, values, chapters / all);
        return [
          L('exp.summary', { books: list.length, chapters, files: packed }),
          bytes ? L('exp.about', { size: formatBytes(bytes) }) : '',
          ...lossOf(values.format).map((id) => L(`exp.loss.${id}`)),
        ].filter(Boolean).join(' ');
      };

      const formatNow = saved.format;
      const mine = (format) => saved.formats[format] ?? {};
      const answers = await shell.form({
        title: L('exp.title', { name }),
        confirm: L('exp.do'),
        fields: [
          {
            type: 'group',
            fields: [
              {
                id: 'format',
                label: L('exp.format'),
                type: 'select',
                value: formatNow,
                options: WRITERS.map((writer) => ({ id: writer.id, label: L(`src.fmt.${writer.id}`) })),
              },
              {
                id: 'pack',
                label: L('exp.package'),
                type: 'select',
                value: mine(formatNow).pack ?? 'file',
                options: [
                  { id: 'file', label: L('exp.pack.file'), show: (v) => fileCount(v) === 1 },
                  { id: 'gzip', label: L('exp.pack.gzip'), show: (v) => fileCount(v) === 1 },
                  { id: 'zip', label: L('exp.pack.zip') },
                ],
              },
            ],
          },
          {
            id: 'scope',
            label: L('exp.scope'),
            type: 'choice',
            value: 'all',
            options: [
              { id: 'all', label: L('exp.all') },
              ...category.testaments.map((t) => ({ id: `t${t.id}`, label: t.name })),
            ],
            // Naming books is the same question, answered more precisely, so
            // it belongs on the same line rather than under a choice that
            // exists only to point at it.
            free: { id: 'book', label: L('exp.book'), placeholder: L('exp.bookPlaceholder') },
          },
          {
            id: 'include',
            label: L('exp.include'),
            type: 'chips',
            value: mine(formatNow).include ?? ['strongs', 'headings', 'references'],
            options: ['strongs', 'headings', 'references', 'notes'].map((option) => ({
              id: option,
              label: L(`exp.inc.${option}`),
              show: (v) => applies(v, option) && carries(option),
            })),
          },
          {
            type: 'group',
            fields: [
              {
                id: 'output',
                label: L('exp.output'),
                type: 'select',
                value: mine(formatNow).output ?? 'readable',
                show: (v) => applies(v, 'compact'),
                options: [
                  { id: 'readable', label: L('exp.out.readable') },
                  { id: 'compact', label: L('exp.out.compact') },
                ],
              },
              {
                id: 'names',
                label: L('exp.names'),
                type: 'select',
                value: mine(formatNow).names ?? 'own',
                show: (v) => applies(v, 'names'),
                options: [
                  { id: 'own', label: L('exp.names.own') },
                  { id: 'english', label: L('exp.names.english') },
                ],
              },
            ],
          },
          { id: 'live', type: 'note', value: '' },
        ],
        // The live line is written on open and after every answer, so nobody
        // presses Export to find out what Export would do.
        onChange: (values, set) => { setLater = set; set('live', summary(values)); },
      });
      if (!answers) return;

      const wanted = booksFor(answers, []);
      if (wanted && !wanted.length) { shell.notify(L('exp.noBooks', { what: answers.book }), 'error'); return; }
      await rememberExport(answers);

      // Only what this format has a use for goes to the writer, and only what
      // the reader could see: a chip hidden for this translation is not an
      // answer, whatever it was left at last time.
      const options = {};
      for (const option of optionsFor(answers.format)) {
        if (option === 'compact') options.compact = answers.output === 'compact';
        else if (option === 'names') options.names = answers.names;
        else options[option] = carries(option) ? answers.include.includes(option) : option !== 'notes';
      }
      if (options.notes) options.noteLabel = L('exp.noteLabel');

      progress.set(identify, L('exp.working'));
      repaint();
      try {
        const { files } = await library.exportTranslation({
          identify, format: answers.format, books: wanted, options,
          notes: options.notes ? notes.map(({ book, chapter, verse, to, text, created }) => ({ book, chapter, verse, to, text, created })) : [],
        });
        if (!files.length) { shell.notify(L('exp.nothing'), 'error'); return; }
        const stem = `${identify}-${answers.format}`;
        let out;
        if (answers.pack === 'zip' || files.length > 1) {
          const about = aboutText(await ctx.store.getMeta(identify), {
            format: L(`src.fmt.${answers.format}`), generated: new Date().toISOString().slice(0, 10),
          });
          out = { name: `${stem}.zip`, blob: await makeDeflatedZip([...files, { name: 'ABOUT.txt', text: about }]) };
        } else if (answers.pack === 'gzip') {
          out = { name: `${files[0].name}.gz`, blob: await gzipText(files[0].text) };
        } else {
          out = { name: files[0].name, blob: new Blob([files[0].text], { type: 'text/plain;charset=utf-8' }) };
        }
        saveText(out.name, out.blob);
        shell.notify(files.length === 1
          ? L('exp.done', { name: out.name, size: formatBytes(out.blob.size) })
          : L('exp.doneMany', { n: files.length, name: out.name, size: formatBytes(out.blob.size) }), 'ok');
      } catch (err) {
        shell.notify(`${name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
        repaint();
      }
    }

    /**
     * The export choices last made, per format, so a reader who always wants
     * compact JSON without Strong's numbers says so once. Kept as a feature
     * record, so it travels in the settings export. Anything unrecognised is
     * dropped rather than trusted: the record may come from a newer build.
     */
    function exportPrefs() {
      const raw = records.get(EXPORT_KEY, null);
      const formats = {};
      const ids = new Set(WRITERS.map((w) => w.id));
      for (const [format, prefs] of Object.entries(raw?.formats ?? {})) {
        if (!ids.has(format) || !prefs || typeof prefs !== 'object') continue;
        formats[format] = {
          ...(['file', 'gzip', 'zip'].includes(prefs.pack) ? { pack: prefs.pack } : {}),
          ...(['readable', 'compact'].includes(prefs.output) ? { output: prefs.output } : {}),
          ...(['own', 'english'].includes(prefs.names) ? { names: prefs.names } : {}),
          ...(Array.isArray(prefs.include)
            ? { include: prefs.include.filter((id) => ['strongs', 'headings', 'references', 'notes'].includes(id)) }
            : {}),
        };
      }
      return { format: ids.has(raw?.format) ? raw.format : 'native', formats };
    }

    function rememberExport(answers) {
      const prefs = exportPrefs();
      prefs.format = answers.format;
      prefs.formats[answers.format] = {
        pack: answers.pack, output: answers.output, names: answers.names, include: [...answers.include],
      };
      return records.save(EXPORT_KEY, prefs);
    }

    /**
     * Roughly how big the download will be, from the size of the stored copy.
     * Said as "about": the ratios are measured on full Bibles and a single
     * short book strays from them, which the notice after the save corrects.
     */
    function estimate(storedBytes, values, share) {
      if (!storedBytes) return 0;
      const RATIO = { native: 1, usfm: 0.8, usx: 1.6, osis: 1.4, zefania: 1.2, csv: 0.85, markdown: 0.85 };
      let bytes = storedBytes * share * (RATIO[values.format] ?? 1);
      if (values.output === 'compact' && optionsFor(values.format).includes('compact')) bytes *= 0.85;
      if (values.pack !== 'file') bytes *= 0.3;
      return Math.max(1024, Math.round(bytes));
    }

    /**
     * Which books an answer means. A typed name wins over the chosen scope,
     * because somebody who typed "Psalms" has been more specific than the
     * segment above it.
     */
    function booksFor(answers, held) {
      const typed = String(answers.book ?? '').trim();
      if (typed) {
        const found = typed.split(/[,;]+/).map((part) => lookupBook(part.trim())).filter(Boolean);
        return found.length ? [...new Set(found)] : [];
      }
      if (answers.scope === 'all') return null;
      const [kind, id] = [answers.scope[0], Number(answers.scope.slice(1))];
      const inScope = category.books
        .filter((book) => (kind === 't' ? book.testament === id : book.section === id))
        .map((book) => book.id);
      return held.length ? inScope.filter((book) => held.includes(book)) : inScope;
    }

    /**
     * A book by whatever the reader called it.
     *
     * Exact first, then prefix — because the canon calls book 19 "Psalm" and
     * almost everybody types "Psalms", and refusing that is being right in a
     * way that helps nobody.
     */
    function lookupBook(text) {
      if (!text) return null;
      const found = shell.readPassage(text);
      if (found?.book) return found.book;
      const wanted = text.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!wanted) return null;
      const names = (book) => [book.name, book.shortname, ...book.abbr]
        .map((one) => String(one).toLowerCase().replace(/[^a-z0-9]/g, ''));
      return category.books.find((book) => names(book).includes(wanted))?.id
        ?? category.books.find((book) => names(book).some((one) => one.startsWith(wanted) || wanted.startsWith(one)))?.id
        ?? null;
    }

    /** "BHS · Biblia hebraica", from what is stored, for a row with no catalog entry. */
    function ownTitle(row) {
      const info = row.held?.info;
      if (!info?.name) return row.identify;
      const short = info.shortname && info.shortname.toLowerCase() !== info.name.toLowerCase() ? info.shortname : '';
      return short ? `${short} · ${info.name}` : info.name;
    }

    /** What a stored translation was imported from, named. */
    const formatName = (id) => (FORMATS.some((f) => f.id === id) ? L(`imp.fmt.${id}`) : L('lib.offline'));

    /** How sure the sniff was about one format, in words. */
    function confidenceOf(guesses, id) {
      const found = guesses.find((g) => g.id === id);
      if (!found) return L('imp.no');
      if (found.confidence >= 0.8) return L('imp.likely');
      return found.confidence >= 0.5 ? L('imp.maybe') : L('imp.possible');
    }

    /**
     * The languages this device asks for, most wanted first, as two-letter
     * codes: what the reader is most likely to want to read.
     */
    const wanted = new Set((typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])
      .filter(Boolean).map((tag) => twoLetter(tag)).filter(Boolean));
    /**
     * Is this one of the reader's own languages?
     *
     * Both sides go through the same mapping, which they did not before: the
     * catalog names a language by its 639-3 code (`nob`, `fin`) and a browser
     * asks for 639-1 (`nb`, `fi`), so this compared two codes that can never be
     * equal and nobody's language was ever recognised. A reader in Oslo was
     * shown sixty translations in alphabetical order with the Norwegian ones
     * somewhere in the middle and no mark on them.
     */
    const suggested = (row) => {
      const code = twoLetter(row.entry?.language.name ?? row.entry?.language.text
        ?? row.held?.info?.language?.iso?.['639-1'] ?? row.held?.info?.language?.name ?? row.language?.code ?? '');
      return Boolean(code) && wanted.has(code);
    };

    // A reader with nothing installed cannot read anything, so the first run
    // opens here rather than on an empty workspace — unless another feature has
    // taken the first screen, in which case this list is one press away from it
    // and does not need to open over it.
    ctx.shell.whenReady(async () => {
      if (ctx.shell.firstRunClaimed) return;
      const installed = await ctx.store.list();
      if (installed.length) return;
      ctx.shell.openDoc('library');
    });

    registry.command({ id: 'library.check', title: L('cmd.checkUpdates'), icon: 'download', run: check });
    registry.command({
      id: 'library.import',
      title: L('imp.cmd'),
      icon: 'enter',
      run: () => importFile().catch((err) => shell.notify(err.message, 'error')),
    });
    registry.command({ id: 'library.open', title: L('doc.library'), icon: 'library', ribbon: true, opens: 'library', run: () => ctx.shell.openDoc('library') });
    registry.command({ id: 'library.study', title: L('sd.cmd'), icon: 'library', run: () => showStudy() });

    registry.doc({
      id: 'library',
      title: L('doc.library'),
      icon: 'library',
      mount(el) {
        let disposed = false;
        const run = () => render().catch((err) => shell.notify(err.message, 'error'));
        repaint = run;
        /**
         * Two pages in one tab. "On this device" is the home: only what is
         * here, so it stays short and calm. "Get more" is the studio for
         * bringing translations in, one source at a time. The home is where
         * the Library opens whenever something is here; with nothing here,
         * there is nothing to show but where to get it.
         */
        let page = pendingPage;
        pendingPage = null;
        let source = SOURCE_IDS.includes(saved?.source) ? saved.source : 'catalog';
        let query = '';
        /** A source's list once read, by id: { rows, fetchedAt } or { error }. */
        const lists = new Map();

        const filter = h('input', {
          type: 'search', spellcheck: 'false',
          placeholder: L('lib.filter'), 'aria-label': L('lib.filter'),
          oninput: (e) => { query = e.currentTarget.value; run(); },
        });
        /*
         * The Cards page's shape: one band of tools across the top and the work
         * under it, with no title and no standing paragraph — the tab already
         * says where this is, and a line of storage and catalog facts read once
         * is a line read past every time after. What is worth knowing sits in
         * the band's readout, and its detail in that readout's tooltip.
         *
         * The band is sticky inside the leaf rather than a scroller of its own,
         * so the leaf stays this page's one scrolling box and keeps its place
         * across repaints and tab changes like every other document.
         */
        const tabs = h('div', { class: 'lib-seg', role: 'tablist', 'aria-label': L('doc.library') });
        const rail = h('div', { class: 'lib-srcs', role: 'tablist', 'aria-label': L('lib.sources') });
        const find = h('div', { class: 'field lib-find' }, icon('search'), filter);
        const readout = h('span', { class: 'lib-readout' });
        const acts = h('div', { class: 'lib-bar-acts' });
        const bar = h('div', { class: 'lib-bar' },
          tabs, h('span', { class: 'lib-bar-sep' }), rail, find, h('span', { class: 'spacer' }), readout, acts);
        const body = h('div', { class: 'library-body' });
        const studio = h('div', { class: 'lib-page' }, body);

        /** A tool of the band: an icon, and what it does as its title. */
        const action = (glyph, label, onclick, extra = '') => h('button', {
          class: `cd-tool lib-act${extra ? ` ${extra}` : ''}`, title: label, 'aria-label': label, onclick,
        }, icon(glyph));

        el.replaceChildren(h('section', { class: 'doc library' }, bar, studio));

        const go = (next) => {
          page = next;
          query = '';
          filter.value = '';
          run();
        };
        const pick = (next) => {
          source = next;
          query = '';
          filter.value = '';
          records.save(KEY, { source: next }).catch(() => { /* a remembered source is not worth a toast */ });
          run();
        };

        async function render() {
          const [rows, storage, sets] = await Promise.all([library.status(), storageStatus(), ctx.study ? ctx.study.list() : []]);
          if (disposed) return;
          const here = rows.filter((row) => row.held);
          page ??= here.length ? 'home' : 'more';
          studio.dataset.page = page;
          bar.dataset.page = page;

          fill(tabs,
            tab('home', 'book', L('lib.tab.home'), here.length),
            tab('more', 'download', L('lib.tab.more'), null),
            ctx.study ? tab('study', 'study', L('lib.tab.study'), sets.length) : null);

          if (page === 'home') paintHome(here, storage);
          else if (page === 'study') paintStudy(sets);
          else await paintMore(rows, here);
          fitBar();
        }

        /**
         * Fit the band to its width by measuring it, as the Cards band fits its
         * tools: a container query cannot know how long a source's name is in
         * Burmese, and a band that is merely allowed to shrink lets one thing
         * slide under another — the filter was covering "From a web address".
         */
        function fitBar() {
          bar.classList.remove('is-tight', 'is-wrapped');
          const over = () => bar.scrollWidth > bar.clientWidth + 1;
          if (!over()) return;
          bar.classList.add('is-tight');
          if (over()) bar.classList.add('is-wrapped');
        }
        const sized = new ResizeObserver(() => fitBar());
        sized.observe(bar);

        /** The readout: a few words, with the rest in its tooltip. */
        function say(text, detail = '') {
          readout.textContent = text;
          readout.title = detail;
          readout.hidden = !text;
        }

        /**
         * The browser may clear what is stored here unless asked not to. Only
         * then is there a tool for it, and it is the one tool in the band with
         * a colour: it is the one that is a warning.
         */
        function keepTool(storage) {
          return storage.persisted === false
            ? action('alert', `${L('lib.notPersistent')} — ${L('lib.keep')}`, () => keep().then(run), 'is-warn')
            : null;
        }

        function tab(id, glyph, label, count) {
          return h('button', {
            class: 'lib-tab', role: 'tab', dataset: { page: id }, 'aria-selected': String(page === id),
            // Its label is hidden in a narrow band; its name must not be.
            title: label, 'aria-label': count === null ? label : `${label} (${count})`,
            onclick: () => go(id),
          }, icon(glyph), h('span', {}, label), count === null ? null : h('span', { class: 'lib-tab-n' }, String(count)));
        }

        // --- On this device ----------------------------------------------------

        function paintHome(here, storage) {
          find.hidden = !here.length;
          say(here.length ? `${formatBytes(storage.usage)}` : '', L('lib.storageUsed', { size: formatBytes(storage.usage) }));
          fill(acts,
            keepTool(storage),
            action('plus', L('imp.cmd'), () => importFile().catch((err) => shell.notify(err.message, 'error'))),
            action('link', L('lib.fromUrl'), () => { page = 'more'; pick('url'); }),
            action('sync', L('cmd.checkUpdates'), check));
          fill(rail);
          const shown = here.filter(matchesHeld);
          const updates = here.filter((row) => row.state === 'update').length;
          keepPlace(body, () => fill(body,
            !here.length
              ? h('div', { class: 'lib-empty' },
                h('span', { class: 'lib-empty-mark' }, icon('library')),
                h('p', { class: 'lib-empty-t' }, L('lib.emptyHome')),
                h('button', { class: 'btn primary', onclick: () => go('more') }, icon('download'), L('lib.getMore')))
              : [
                updates ? h('p', { class: 'lib-banner' }, icon('sync'), L('lib.updatesWaiting', { n: updates })) : null,
                shown.length ? groups(shown, (row) => homeItem(row)) : h('p', { class: 'empty-hint' }, L('lib.noHits', { query: query.trim() })),
              ]));
        }

        function matchesHeld(row) {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          const info = row.held?.info ?? {};
          return [row.identify, info.name, info.shortname, info.language?.text, row.entry?.name]
            .filter(Boolean).join(' ').toLowerCase().includes(q);
        }

        function homeItem(row) {
          const info = row.held.info ?? {};
          const busy = progress.get(row.identify);
          const origin = row.state === 'local' ? formatName(row.held?.source) : null;
          return h('li', { class: `library-item state-${row.state}`, dataset: { identify: row.identify } },
            mark(info.shortname || row.identify),
            h('div', { class: 'library-meta' },
              h('strong', {}, row.entry ? `${row.entry.shortname} · ${row.entry.name}` : ownTitle(row)),
              h('span', { class: 'muted' }, [info.language?.text, row.held ? held(row.held) : null].filter(Boolean).join(' · ')),
              hasLine(row.held?.stats ? contentOfStats(row.held.stats, row.entry?.content) : row.entry?.content),
              faultsBadge(row.held ? row.held.diagnostics?.faults : row.entry?.content?.faults),
              row.state === 'local' ? h('span', { class: 'badge' }, L('lib.yours')) : null,
              origin && row.held?.source !== 'native' ? h('span', { class: 'badge badge-src' }, origin) : null,
              row.state === 'unlisted' ? h('span', { class: 'badge' }, L('lib.unlisted')) : null,
              row.state === 'update' ? h('span', { class: 'badge badge-hint' }, `v${row.installedVersion} → v${row.entry.version}`) : null),
            h('div', { class: 'library-actions' }, busy
              ? h('span', { class: 'muted' }, busy)
              : [
                row.state === 'update'
                  ? h('button', { class: 'btn soft', dataset: { place: `install:${row.identify}` }, onclick: () => act(row.identify, 'install') }, icon('sync'), L('lib.update'))
                  : null,
                h('button', {
                  class: 'lib-act', title: L('lib.read'), 'aria-label': L('lib.read'),
                  onclick: () => { shell.workspace.setPaneTranslation(0, row.identify); const { book, chapter } = state.get(); shell.openChapter(book, chapter); },
                }, icon('book-open')),
                h('button', {
                  class: 'lib-act', title: L('lib.more'), 'aria-label': L('lib.more'), 'aria-haspopup': 'menu',
                  dataset: { place: `menu:${row.identify}` },
                  onclick: (e) => rowMenu(e.currentTarget, row),
                }, icon('more')),
              ]));
        }

        /**
         * What a translation carries, as a row of quiet labels — both
         * testaments, Strong's numbers, cross-references, headings — each
         * with its count in its tooltip. Only what is there is named; a
         * translation the catalog has no figures for shows none.
         */
        function hasLine(content) {
          const found = featuresOf(content);
          if (!found.length) return null;
          const n = (value) => new Intl.NumberFormat(currentLocale()).format(value);
          return h('span', { class: 'lib-has', 'aria-label': L('lib.has.label') },
            found.map(({ id, n: count }) => h('span', {
              class: `lib-has-i is-${id}`, dataset: { has: id }, title: L(`lib.has.${id}Hint`, { n: n(count) }),
            }, L(`lib.has.${id}`))));
        }

        /**
         * Faults in a translation's file that the app reads past, said before
         * it is downloaded and after: a press says which, in words.
         */
        function faultsBadge(faults) {
          const kinds = Object.entries(faults ?? {});
          if (!kinds.length) return null;
          const said = `${L('lib.faults.what')} ${kinds.map(([kind, n]) => L(`lib.faults.${kind}`, { n })).join('; ')}.`;
          return h('button', {
            class: 'badge badge-warn', title: said, dataset: { faults: kinds.map(([kind]) => kind).join(' ') },
            onclick: (event) => { event.stopPropagation(); shell.notify(said); },
          }, icon('alert'), L('lib.faults'));
        }

        /** A translation's short name, as a small square: the eye finds a row by it. */
        function mark(text) {
          const letters = [...String(text).replace(/[^\p{L}\p{N}]/gu, '')].slice(0, 3).join('') || '·';
          return h('span', { class: 'lib-mark', 'aria-hidden': 'true' }, letters);
        }

        /** Rows by language, the reader's own languages first. */
        function groups(rows, draw) {
          const by = new Map();
          for (const row of rows) {
            const lang = row.held?.info?.language?.text ?? row.entry?.language.text ?? row.language?.name ?? L('lib.unlistedGroup');
            if (!by.has(lang)) by.set(lang, []);
            by.get(lang).push(row);
          }
          const mine = (list) => (list.some(suggested) ? 0 : 1);
          return [...by.entries()]
            .sort(([a, x], [b, y]) => mine(x) - mine(y) || a.localeCompare(b))
            .map(([lang, list]) => h('div', { class: 'library-group' },
              h('h2', {}, lang, h('span', { class: 'lib-group-n' }, String(list.length))),
              h('ul', { class: 'library-list' }, list.map(draw))));
        }

        // --- Study data ----------------------------------------------------------

        /**
         * What the reading can draw on besides translations: cross-references,
         * topical indexes and dictionaries, each kind with what is here and
         * where more is to be had. Lexicons keep their place in Settings →
         * Study, where they have always been; a lexicon file brought here is
         * still recognised and goes there.
         */
        function paintStudy(sets) {
          find.hidden = true;
          say(sets.length ? L('sd.held', { n: sets.length }) : '');
          fill(rail);
          fill(acts, action('plus', L('sd.import'), () => importFile().catch((err) => shell.notify(err.message, 'error'))));
          const busy = [...progress.entries()].filter(([key]) => key.startsWith('study:'));
          keepPlace(body, () => fill(body,
            busy.length ? h('p', { class: 'lib-banner' }, icon('sync'), busy.map(([, text]) => text).join(' · ')) : null,
            ...STUDY_TYPES.map((type) => {
              const mine = sets.filter((set) => set.type === type);
              const offered = STUDY_SOURCES.filter((src) => src.type === type);
              return h('div', { class: 'library-group sd-group', dataset: { type } },
                h('h2', {}, L(`sd.type.${type}`), h('span', { class: 'lib-group-n' }, String(mine.length))),
                h('p', { class: 'sd-what' }, L(`sd.typeHint.${type}`)),
                mine.length ? h('ul', { class: 'library-list' }, mine.map(studyItem)) : null,
                h('ul', { class: 'library-list sd-sources' }, offered.map((src) => studySourceItem(src, mine))));
            })));
        }

        function studyItem(set) {
          return h('li', { class: 'library-item state-installed sd-item', dataset: { study: set.id } },
            h('span', { class: 'lib-mark', 'aria-hidden': 'true' }, icon(STUDY_ICON[set.type])),
            h('div', { class: 'library-meta' },
              h('strong', {}, set.name),
              h('span', { class: 'muted' }, [L(`sd.count.${set.type}`, { n: set.count }), formatBytes(set.bytes), when.date(set.installedAt)].join(' · ')),
              h('span', { class: 'muted sd-credit' }, [set.source, set.licence].filter(Boolean).join(' · '))),
            h('div', { class: 'library-actions' },
              h('button', {
                class: 'lib-act', title: L('sd.remove'), 'aria-label': `${L('sd.remove')}: ${set.name}`,
                onclick: async () => {
                  const sure = await shell.confirm({ title: L('sd.removeTitle', { name: set.name }), body: L('sd.removeBody'), confirm: L('sd.remove'), danger: true });
                  if (!sure) return;
                  await ctx.study.remove(set.id);
                  shell.notify(L('sd.removed', { name: set.name }), 'ok');
                },
              }, icon('trash'))));
        }

        /** A publisher's edition: get it, or go to its page to save it by hand. */
        function studySourceItem(src, mine) {
          const have = mine.some((set) => set.name.toLowerCase().includes(src.name.split(/[’'(]/)[0].trim().toLowerCase().slice(0, 12)));
          const busy = progress.get(`study:${src.id}`);
          return h('li', { class: 'library-item sd-source', dataset: { source: src.id } },
            h('span', { class: 'lib-mark', 'aria-hidden': 'true' }, icon('download')),
            h('div', { class: 'library-meta' },
              h('strong', {}, src.name),
              h('span', { class: 'muted' }, [src.licence, new URL(src.url).host].join(' · '))),
            h('div', { class: 'library-actions' }, busy
              ? h('span', { class: 'muted' }, busy)
              : [
                h('a', { class: 'lib-act', href: src.page, target: '_blank', rel: 'noopener', title: L('sd.page'), 'aria-label': `${L('sd.page')}: ${src.name}` }, icon('link')),
                h('button', {
                  class: `btn ${have ? 'soft' : 'primary'}`, dataset: { get: src.id },
                  onclick: () => getStudy(src),
                }, icon(have ? 'sync' : 'download'), L(have ? 'sd.getAgain' : 'sd.get')),
              ]));
        }

        /**
         * The publisher's file, or the copy in the catalog repository. The
         * desktop app goes to the publisher first; a web page to the copy,
         * since a publisher's site seldom allows a page to read from it. Each
         * falls back on the other, and only when both fail is the reader told
         * — about the publisher's, which is the one the reader can act on.
         */
        async function getStudy(src) {
          progress.set(`study:${src.id}`, L('lib.downloading'));
          run();
          const hosted = ctx.config.repoFileUrl.replace('{path}', `study/${src.id}.json`);
          const order = sources.viaApp ? [src.url, hosted] : [hosted, src.url];
          try {
            let got = null;
            let from = null;
            const failed = new Map();
            for (const url of order) {
              try {
                got = await sources.download(url, src.name);
                from = url;
                break;
              } catch (err) {
                failed.set(url, err);
              }
            }
            progress.delete(`study:${src.id}`);
            if (!got) { notFetched(failed.get(src.url) ?? failed.get(hosted), src.name, src.page); return; }
            const name = decodeURIComponent(new URL(from).pathname.split('/').pop());
            await importFile({ name, size: got.bytes.byteLength, bytes: got.bytes, text: got.text(), studyType: src.type });
          } finally {
            progress.delete(`study:${src.id}`);
            run();
          }
        }

        // --- Get more ----------------------------------------------------------

        async function paintMore(rows, here) {
          const heldRows = here.map((row) => row.held);
          fill(rail, ...SOURCE_IDS.map((id) => h('button', {
            class: 'lib-src', role: 'tab', dataset: { source: id }, 'aria-selected': String(source === id),
            title: `${L(`lib.src.${id}`)} — ${sourceCount(id, rows)}`, 'aria-label': L(`lib.src.${id}`),
            onclick: () => pick(id),
          }, icon(SOURCE_ICON[id]), h('span', { class: 'lib-src-t' }, L(`lib.src.${id}`)))));

          const listing = source !== 'url' && source !== 'file';
          find.hidden = !listing;
          if (!listing) {
            say('');
            fill(acts);
            if (source === 'url') paintUrl(); else paintFile();
            return;
          }

          if (source === 'catalog') {
            const catalog = library.catalog;
            const bundled = library.origin === 'bundled';
            say(bundled ? L('lib.bundledShort') : L('lib.catalogShort', { version: catalog.version }),
              bundled ? L('lib.bundled') : L('lib.catalog', { version: catalog.version, updated: when.date(catalog.updated), checked: when.dateTime(library.fetchedAt) }));
            // A list bundled with the build may be out of date; checking it is
            // then the thing to do, and the tool says so by its colour.
            fill(acts, action('sync', bundled ? L('lib.checkNow') : L('cmd.checkUpdates'), () => check().then(run), bundled ? 'primary' : ''));
          } else {
            const got = lists.get(source);
            say(got?.rows ? L('lib.count', { n: got.rows.length }) : '', got?.rows ? L('lib.listed', { n: got.rows.length, when: when.date(got.fetchedAt) }) : '');
            fill(acts, action('sync', L('lib.refreshList'), () => loadList(source, true)));
          }

          if (source === 'catalog') {
            const listed = rows.filter((row) => row.entry && matchesEntry(row));
            keepPlace(body, () => fill(body, listed.length
              ? groups(listed, (row) => catalogItem(row))
              : h('p', { class: 'empty-hint' }, L('lib.noHits', { query: query.trim() }))));
            return;
          }

          const got = lists.get(source);
          if (!got) {
            fill(body, h('p', { class: 'lib-loading' }, L('lib.loadingList', { source: L(`lib.src.${source}`) })));
            loadList(source, false);
            return;
          }
          if (got.error) {
            fill(body, h('div', { class: 'lib-empty' },
              h('span', { class: 'lib-empty-mark' }, icon('alert')),
              h('p', { class: 'lib-empty-t' }, got.error),
              h('button', { class: 'btn', onclick: () => loadList(source, true) }, icon('sync'), L('lib.tryAgain'))));
            return;
          }
          const matching = got.rows.filter(matchesSourceRow);
          const shown = matching.slice(0, LIST_CAP);
          keepPlace(body, () => fill(body,
            source === 'ebible' && !sources.viaApp ? h('p', { class: 'lib-banner is-warn' }, icon('alert'), L('lib.webLimit')) : null,
            shown.length ? groups(shown, (row) => sourceItem(row, heldRows)) : h('p', { class: 'empty-hint' }, L('lib.noHits', { query: query.trim() })),
            matching.length > shown.length ? h('p', { class: 'lib-more-hint' }, L('lib.capped', { n: shown.length, of: matching.length })) : null));
        }

        function sourceCount(id, rows) {
          if (id === 'catalog') return L('lib.count', { n: rows.filter((row) => row.entry).length });
          if (id === 'url') return L('lib.src.urlSub');
          if (id === 'file') return L('lib.src.fileSub');
          const got = lists.get(id);
          return got?.rows ? L('lib.count', { n: got.rows.length }) : L('lib.src.notRead');
        }

        async function loadList(id, refresh) {
          lists.set(id, lists.get(id)?.rows ? lists.get(id) : null);
          if (refresh) fill(body, h('p', { class: 'lib-loading' }, L('lib.loadingList', { source: L(`lib.src.${id}`) })));
          try {
            lists.set(id, await sources.list(id, { refresh }));
          } catch (err) {
            lists.set(id, { error: err.message });
          }
          if (!disposed && page === 'more' && source === id) run();
        }

        function matchesEntry(row) {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          const e = row.entry;
          return [row.identify, e?.name, e?.shortname, e?.language.text, e?.publisher, e?.year]
            .filter(Boolean).join(' ').toLowerCase().includes(q);
        }

        function matchesSourceRow(row) {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return [row.id, row.name, row.shortname, row.language.name, row.language.code, row.license]
            .filter(Boolean).join(' ').toLowerCase().includes(q);
        }

        function catalogItem(row) {
          const e = row.entry;
          const busy = progress.get(row.identify);
          const here = Boolean(row.held);
          return h('li', { class: `library-item state-${row.state}`, dataset: { identify: row.identify } },
            mark(e.shortname),
            h('div', { class: 'library-meta' },
              h('strong', {}, `${e.shortname} · ${e.name}`),
              h('span', { class: 'muted' }, [e.year, e.publisher].filter(Boolean).join(' · ')),
              hasLine(e.content),
              faultsBadge(row.held ? row.held.diagnostics?.faults : e.content?.faults),
              here && row.state !== 'update' ? h('span', { class: 'badge badge-ok' }, icon('check'), L('lib.onDevice')) : null,
              row.state === 'update' ? h('span', { class: 'badge badge-hint' }, `v${row.installedVersion} → v${e.version}`) : null,
              !here && suggested(row) ? h('span', { class: 'badge badge-hint' }, L('lib.suggested')) : null),
            h('div', { class: 'library-actions' }, busy
              ? h('span', { class: 'muted' }, busy)
              : !here
                ? h('button', { class: 'btn soft', dataset: { place: `install:${row.identify}` }, onclick: () => act(row.identify, 'install') }, icon('download'), L('lib.install'))
                : row.state === 'update'
                  ? h('button', { class: 'btn soft', dataset: { place: `install:${row.identify}` }, onclick: () => act(row.identify, 'install') }, icon('sync'), L('lib.update'))
                  : h('button', { class: 'lib-act', title: L('lib.more'), 'aria-label': L('lib.more'), 'aria-haspopup': 'menu', onclick: (ev) => rowMenu(ev.currentTarget, row) }, icon('more'))));
        }

        function sourceItem(row, heldRows) {
          const found = onDevice(row, heldRows);
          const busy = progress.get(row.identify);
          return h('li', { class: `library-item src-item${found.exact ? ' state-installed' : ''}`, dataset: { identify: row.identify } },
            mark(row.shortname),
            h('div', { class: 'library-meta' },
              h('strong', {}, row.name),
              h('span', { class: 'muted' }, [row.shortname, row.language.code, row.year, row.license].filter(Boolean).join(' · ')),
              found.exact ? h('span', { class: 'badge badge-ok' }, icon('check'), L('lib.onDevice')) : null,
              found.same ? h('span', { class: 'badge badge-hint', title: L('lib.sameAsHint') }, L('lib.sameAs', { name: found.same.info?.shortname || found.same.identify })) : null),
            h('div', { class: 'library-actions' }, busy
              ? h('span', { class: 'muted' }, busy)
              : found.exact
                ? null
                : h('button', { class: 'btn soft', onclick: () => installFrom(row) }, icon('download'), L('lib.get'))));
        }

        function paintUrl() {
          const input = h('input', {
            type: 'url', inputmode: 'url', spellcheck: 'false', placeholder: 'https://…', 'aria-label': L('lib.urlLabel'),
            onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchUrl(input.value); } },
          });
          fill(body, h('div', { class: 'lib-panel' },
            h('p', { class: 'muted' }, L('lib.urlHint')),
            h('div', { class: 'lib-url' }, h('div', { class: 'field' }, icon('link'), input),
              h('button', { class: 'btn primary', onclick: () => fetchUrl(input.value) }, icon('download'), L('lib.urlGo'))),
            sources.viaApp ? null : h('p', { class: 'lib-web-note' }, icon('alert'), L('lib.webLimit'))));
          input.focus();
        }

        function paintFile() {
          fill(body, h('div', { class: 'lib-panel' },
            h('p', { class: 'muted' }, L('lib.fileHint')),
            h('button', { class: 'btn primary', onclick: () => importFile().catch((err) => shell.notify(err.message, 'error')) }, icon('plus'), L('lib.fileGo'))));
        }

        async function fetchUrl(value) {
          const url = String(value ?? '').trim();
          if (!url) return;
          let parsed;
          try { parsed = new URL(url); } catch { shell.notify(L('lib.urlBad', { url }), 'error'); return; }
          const name = decodeURIComponent(parsed.pathname.split('/').pop() || parsed.host);
          shell.notify(L('lib.urlFetching', { name }));
          try {
            const got = await sources.download(parsed.href, name);
            await importFile({ name, size: got.bytes.byteLength, bytes: got.bytes, text: got.text() });
          } catch (err) {
            notFetched(err, name, parsed.href);
          }
        }

        /**
         * A download that failed, said as what happened, with what does work:
         * the page to save the file from, and adding the saved file.
         */
        function notFetched(err, name, page) {
          const said = err?.code ? L(`dl.${err.code}`, { name, host: err.host ?? '', status: err.status ?? '' }) : `${name}: ${err?.message ?? err}`;
          const open = ctx.platform?.capabilities?.openExternal;
          shell.notify(said, 'error', {
            actions: [
              page && typeof open === 'function' ? { label: L('dl.openPage'), icon: 'link', run: () => Promise.resolve(open(page)).catch((e) => shell.notify(e.message, 'error')) } : null,
              { label: L('dl.addFile'), icon: 'plus', run: () => importFile().catch((e) => shell.notify(e.message, 'error')) },
            ].filter(Boolean),
          });
        }

        /** A translation from getBible or eBible.org, straight in: the source already said what it is. */
        async function installFrom(row) {
          progress.set(row.identify, L('lib.downloading'));
          run();
          try {
            const got = await sources.download(row.url, row.name);
            progress.set(row.identify, L('lib.converting'));
            run();
            const info = { name: row.name, language: row.language.code, source: row.source };
            const result = row.kind === 'zip'
              ? await library.importPack({ files: await archiveTexts(got.bytes, row.name), identify: row.identify, info })
              : await library.importTranslation({ text: got.text(), format: 'getbible', identify: row.identify, info });
            shell.notify(L('lib.gotFrom', {
              name: row.name, source: L(`lib.src.${row.source}`),
              notes: [`${L('lbl.books', { n: result.stats.books })}, ${L('lbl.verses', { n: result.stats.verses })}`, strongsLine(result.stats)]
                .filter(Boolean).join(' · '),
            }), 'ok', { actions: [{ label: L('lib.readIt'), icon: 'book-open', run: () => shell.readTranslation(row.identify) }] });
          } catch (err) {
            if (err?.code) notFetched(err, row.name, row.page ?? null);
            else shell.notify(`${row.name}: ${err.message}`, 'error');
          } finally {
            progress.delete(row.identify);
            run();
          }
        }

        /**
         * This used to read "65 books · 50 differences", which raises two
         * questions and answers neither: is a book missing, and different how?
         * Both are knowable, so both are said.
         */
        function held(record) {
          const all = category.books.length;
          const diag = record.diagnostics ?? {};
          const books = record.stats
            ? (record.stats.books === all ? L('lbl.books', { n: all }) : L('lbl.ofBooks', { n: record.stats.books, all }))
            : null;
          return [
            record.bytes ? formatBytes(record.bytes) : null,
            books,
            diag.missing && !record.stats ? L('lbl.booksMissing', { n: diag.missing }) : null,
            diag.short ? L('lbl.chaptersShort', { n: diag.short }) : null,
            diag.extra ? L('lbl.chaptersExtra', { n: diag.extra }) : null,
            !diag.missing && !diag.short && !diag.extra && diag.total && !Object.keys(diag.faults ?? {}).length
              ? L('lbl.differs', { n: diag.total }) : null,
          ].filter(Boolean).join(' · ');
        }

        openSource = (id) => { page = 'more'; pick(id); };
        showHome = () => go('home');
        studyGo = () => go('study');
        const offStudy = ctx.study?.on('change', run);
        const offChange = library.on('change', run);
        const offProgress = library.on('progress', ({ detail }) => {
          const phase = { download: L('lib.downloading'), convert: L('lib.converting'), validate: L('lib.validating'), write: L('lib.saving') }[detail.phase];
          progress.set(detail.identify, detail.received ? `${phase} ${formatBytes(detail.received)}` : `${phase}…`);
          run();
        });
        run();
        return () => { disposed = true; repaint = () => {}; openSource = null; showHome = null; studyGo = null; sized.disconnect(); offChange(); offProgress(); offStudy?.(); };
      },
    });

    /** Everything that can be done to one translation that is on this device. */
    function rowMenu(anchor, row) {
      const name = row.entry?.name ?? row.held?.info?.name ?? row.identify;
      openMenu(anchor, [
        {
          id: 'export',
          title: L('exp.cmd'),
          icon: 'download',
          run: () => exportTranslation(row.identify).catch((err) => shell.notify(err.message, 'error')),
        },
        {
          id: 'info',
          title: L('lib.about', { name }),
          icon: 'info',
          run: () => shell.openTranslationInfo(anchor, row.held),
        },
        ...(row.held && registry.hasCommand('report.open') ? [{
          id: 'report',
          title: L('lib.report', { name }),
          icon: 'inspector',
          run: () => { state.set({ reportFor: row.identify }); shell.openDoc('report'); },
        }] : []),
        ...(row.state === 'update' ? [{
          id: 'update', title: L('lib.update'), icon: 'sync', run: () => act(row.identify, 'install'),
        }] : []),
        {
          id: 'remove',
          title: L('lib.remove'),
          icon: 'trash',
          run: () => act(row.identify, 'remove'),
        },
      ]);
    }
  },
};
