/**
 * Library: browse the catalog, make translations available offline, update
 * and remove them, and check the remote catalog for changes.
 */

import { describe, FORMATS, sniff, slug } from '../../core/formats/index.js';
import { classify, readMetadata } from '../../core/formats/pack.js';
import { aboutText, lossOf, optionsFor, WRITERS } from '../../core/formats/write.js';
import { twoLetter } from '../../core/langcode.js';
import { pickFile, saveText } from '../../services/transfer.js';
import { gzipText, makeDeflatedZip, openZip } from '../../services/zip.js';
import { fill, formatBytes, h, keepPlace } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { openMenu } from '../../shell/menu.js';
import { L, when } from '../../shell/i18n.js';
import { requestPersistence, storageStatus } from '../../services/store.js';

/** How the list is arranged. The choice is remembered. */
const VIEWS = Object.freeze(['language', 'all', 'offline', 'mine']);
const KEY = 'library';


/** The feature record holding the export dialog's last answers. */
const EXPORT_KEY = 'library.export';
export default {
  id: 'library',
  setup(ctx) {
    const { annotations, category, library, records, registry, shell, state } = ctx;
    const progress = new Map(); // identify -> text
    // The page repaints itself while it is open; an import can be started from
    // the command palette with the page shut, and then there is nothing to
    // repaint and nothing that needs to be.
    let repaint = () => {};
    let query = '';
    const held = records.get(KEY, null);
    let view = VIEWS.includes(held?.view) ? held.view : VIEWS[0];
    const setView = (next) => {
      view = next;
      records.save(KEY, { view: next }).catch(() => { /* a view is not worth a toast */ });
    };

    // How the library lists itself is a setting; the page also offers it, which
    // is where a reader who is already looking at the list will change it.
    registry.setting({
      id: 'library.view',
      section: 'storage',
      order: 10,
      build: (ui) => ui.choice({
        name: L('set.libraryView'),
        hint: L('set.libraryViewHint'),
        options: VIEWS.map((id) => [id, L(`lib.view.${id}`)]),
        value: view,
        onChange: (next) => { setView(next); ui.refresh(); },
      }),
    });

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
          shell.notify(notes ? L('lib.installedNoted', { name, notes }) : L('lib.installed', { name }), 'ok');
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
    async function importFile() {
      const file = await pickFile({
        accept: '.zip,.json,.usfm,.sfm,.usfx,.usx,.osis,.xml,.zef,.csv,.tsv,.txt,text/*,application/zip',
      });
      if (!file) return;
      if (/\.zip$/i.test(file.name) || isZip(file.bytes)) { await importArchive(file); return; }

      const guesses = sniff(file.text, file.name);
      if (!guesses.length) {
        shell.notify(L('imp.unknown', { file: file.name }), 'error');
        return;
      }
      const best = guesses[0].id;
      const found = describe(file.text, best, file.name);

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
        onChange: (values, set) => {
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
          result.diagnostics.length ? L('lbl.differs', { n: result.diagnostics.length }) : '',
          result.report?.notes ? L('imp.notesDropped', { n: result.report.notes }) : '',
          result.report?.skipped ? L('imp.skipped', { n: result.report.skipped }) : '',
        ].filter(Boolean).join(' · ');
        shell.notify(L('imp.done', { name: answers.name || identify, notes }), 'ok');
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
        repaint();
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
      let entries = [];
      try {
        entries = openZip(file.bytes);
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
        return;
      }
      // Only the text files: a bundle carries fonts and signatures too, and
      // inflating a 4 MB font to look at it would be work for nothing.
      const wanted = entries.filter((entry) => entry.size > 0 && entry.size < 80 * 1024 * 1024
        && !/\.(?:ttf|otf|woff2?|png|jpe?g|gif|pdf|zip|epub|mobi)$/i.test(entry.name));
      const files = [];
      for (const entry of wanted) {
        try {
          files.push({ name: entry.name.split('/').pop(), text: await entry.text() });
        } catch {
          // One unreadable member is not a reason to refuse the archive; the
          // assembler reports what it did not use.
        }
      }
      if (!files.length) { shell.notify(L('imp.emptyZip', { file: file.name }), 'error'); return; }

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
          report.strongs ? L('imp.withStrongs', { n: report.strongs }) : '',
          report.named ? L('imp.withNames', { n: report.named }) : '',
          result.diagnostics.length ? L('lbl.differs', { n: result.diagnostics.length }) : '',
        ].filter(Boolean).join(' · ');
        shell.notify(L('imp.done', { name: answers.name || identify, notes }), 'ok');
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
        repaint();
      }
    }

    /**
     * What is in this archive, for the dialog — read from the bundle's own
     * metadata where it has any, so the reader confirms rather than types.
     */
    function packDescribe(files, archiveName) {
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
      const code = twoLetter(row.entry?.language.name ?? row.entry?.language.text ?? '');
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

    registry.doc({
      id: 'library',
      title: L('doc.library'),
      icon: 'library',
      mount(el) {
        let disposed = false;
        const run = () => render().catch((err) => shell.notify(err.message, 'error'));
        repaint = run;

        const filter = h('input', {
          type: 'search', spellcheck: 'false', value: query,
          placeholder: L('lib.filter'), 'aria-label': L('lib.filter'),
          oninput: (e) => { query = e.currentTarget.value; run(); },
        });

        /** Name, abbreviation, language or identify — whatever the reader types. */
        function matches(row) {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          const e = row.entry;
          return [row.identify, e?.name, e?.shortname, e?.language.text, e?.publisher, e?.year]
            .filter(Boolean).join(' ').toLowerCase().includes(q);
        }

        /**
         * The page is built once and only the list is replaced afterwards.
         * Rebuilding the whole document on every keystroke moved the filter
         * field in the document, and moving a focused element takes the focus
         * with it — the caret jumped out of the box on every letter typed.
         */
        const note = h('p', { class: 'muted' });
        const count = h('span', { class: 'muted lib-count' });
        const views = h('div', { class: 'rp-seg lib-views' }, VIEWS.map((id) => h('button', {
          dataset: { view: id }, 'aria-pressed': String(id === view),
          onclick: () => { setView(id); paintViews(); run(); },
        }, L(`lib.view.${id}`))));
        const list = h('div', { class: 'library-body' });

        /** An icon button in the tools row: what it does is its title. */
        const action = (glyph, label, onclick) => h('button', {
          class: 'lib-act', title: label, 'aria-label': label, onclick,
        }, icon(glyph));

        const paintViews = () => {
          for (const button of views.children) button.setAttribute('aria-pressed', String(button.dataset.view === view));
        };

        el.replaceChildren(h('section', { class: 'doc library' },
          h('header', { class: 'doc-head' },
            h('h1', { class: 'inline-title' }, L('doc.library')),
            note,
            h('div', { class: 'lib-tools' },
              h('div', { class: 'field' }, icon('search'), filter),
              views,
              h('span', { class: 'grow' }),
              count,
              // Two icons rather than two sentences. Add and refresh are drawn
              // the same way everywhere, they take a quarter of the room, and
              // the row still reads at a glance in a language this build has
              // never been translated into.
              action('plus', L('imp.cmd'), () => importFile().catch((err) => shell.notify(err.message, 'error'))),
              action('sync', L('cmd.checkUpdates'), check))),
          list));

        async function render() {
          const [rows, storage] = await Promise.all([library.status(), storageStatus()]);
          if (disposed) return;
          const catalog = library.catalog;
          const header = library.origin === 'bundled'
            ? L('lib.bundled')
            : L('lib.catalog', {
              version: catalog.version,
              updated: when.date(catalog.updated),
              checked: when.dateTime(library.fetchedAt),
            });

          const mode = view;
          const shown = rows.filter(matches).filter((row) => {
            if (mode === 'offline') return row.state !== 'available';
            // What the reader imported themselves, which is the one group
            // nothing else in this list can be filtered down to.
            if (mode === 'mine') return row.state === 'local';
            return true;
          });
          const byName = (a, b) => (a.entry?.name ?? a.identify).localeCompare(b.entry?.name ?? b.identify);

          const groups = new Map();
          if (mode === 'language') {
            for (const row of shown) {
              const lang = row.entry?.language.text ?? L('lib.unlistedGroup');
              if (!groups.has(lang)) groups.set(lang, []);
              groups.get(lang).push(row);
            }
          } else {
            groups.set('', [...shown].sort(byName));
          }
          // The reader's own languages come first, whatever the arrangement.
          const ordered = [...groups.entries()].sort(([a, listA], [b, listB]) => {
            const mine = (l) => (l.some(suggested) ? 0 : 1);
            return mine(listA) - mine(listB) || a.localeCompare(b);
          });

          fill(note,
            `${header} `,
            // The bundled seed carries a dozen translations and the catalog
            // carries five times as many, so a reader whose first check never
            // landed is looking at a short list with no idea it is short. The
            // sentence said so; it needed the press that fixes it beside it.
            library.origin === 'bundled'
              ? h('button', { class: 'link-btn', onclick: () => check().then(run) }, L('lib.checkNow'))
              : null,
            ` · ${L('lib.storageUsed', { size: formatBytes(storage.usage) })}`,
            storage.persisted === false
              ? [' · ', L('lib.notPersistent'), ' ',
                h('button', { class: 'link-btn', onclick: () => keep().then(run) }, L('lib.keep'))]
              : null);
          count.textContent = L('lib.count', { n: shown.length });
          // Installing or removing repaints this list; the reader stays where
          // they were looking, with the focus still on the button they pressed.
          keepPlace(list, () => fill(list, (shown.length
            ? ordered.map(([lang, group]) => h('div', { class: 'library-group' },
              lang ? h('h2', {}, lang) : null,
              h('ul', { class: 'library-list' }, group.map((row) => item(row)))))
            : h('p', { class: 'empty-hint' }, mode === 'mine' && !query.trim()
              ? L('lib.noneYours')
              : L('lib.noHits', { query: query.trim() })))));
        }

        function item(row) {
          const e = row.entry;
          const busy = progress.get(row.identify);
          const actions = {
            available: [[L('lib.install'), 'install']],
            installed: [[L('lib.remove'), 'remove']],
            update: [[L('lib.update'), 'install'], [L('lib.remove'), 'remove']],
            unlisted: [[L('lib.remove'), 'remove']],
            local: [[L('lib.remove'), 'remove']],
          }[row.state];
          return h('li', { class: `library-item state-${row.state}`, dataset: { identify: row.identify } },
            h('div', { class: 'library-meta' },
              h('strong', {}, e ? `${e.shortname} · ${e.name}` : row.identify),
              h('span', { class: 'muted' }, e
                ? [e.year, e.publisher].filter(Boolean).join(' · ')
                : L(row.state === 'local' ? 'lib.yours' : 'lib.unlisted')),
              row.state === 'local' ? h('span', { class: 'badge badge-ok' }, formatName(row.held?.source)) : null,
              row.state === 'update' ? h('span', { class: 'badge' }, `v${row.installedVersion} → v${e.version}`) : null,
              row.state === 'installed' ? h('span', { class: 'badge badge-ok' }, L('lib.offline')) : null,
              // What is actually on the device, for a row that has something on it.
              row.held ? h('span', { class: 'muted lib-held' }, held(row.held)) : null,
              row.state === 'available' && suggested(row) ? h('span', { class: 'badge badge-hint' }, L('lib.suggested')) : null),
            h('div', { class: 'library-actions' }, busy
              ? h('span', { class: 'muted' }, busy)
              : [
                // The one press most readers want, and everything else behind
                // the menu: a row with five buttons on it is a row nobody reads.
                // A soft button, not a solid one: the list is a column of these,
                // and sixty solid accent buttons outshout the names beside them.
                ...actions.slice(0, 1).map(([label, action]) => h('button', {
                  class: action === 'remove' ? 'btn' : 'btn soft',
                  dataset: { place: `${action}:${row.identify}` },
                  onclick: () => act(row.identify, action),
                }, label)),
                row.held ? h('button', {
                  class: 'lib-act', title: L('lib.more'), 'aria-label': L('lib.more'),
                  'aria-haspopup': 'menu',
                  dataset: { place: `menu:${row.identify}` },
                  onclick: (e) => rowMenu(e.currentTarget, row),
                }, icon('more')) : null,
              ]));
        }

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
        // Only for a translation that is here: the report reads the chapters
        // on this device, and there are none for one that has not been
        // installed.
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

    /** The stored copy in one line: how big it is, and whether it holds the whole canon. */
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
            // "4 of 66 books" already says 62 are missing; saying both is
            // saying the same thing twice in a line that has to stay short.
            diag.missing && !record.stats ? L('lbl.booksMissing', { n: diag.missing }) : null,
            diag.short ? L('lbl.chaptersShort', { n: diag.short }) : null,
            diag.extra ? L('lbl.chaptersExtra', { n: diag.extra }) : null,
            // A record written by an older build has only the total; it still
            // says something rather than nothing.
            !diag.missing && !diag.short && !diag.extra && diag.total
              ? L('lbl.differs', { n: diag.total }) : null,
          ].filter(Boolean).join(' · ');
        }

        const offChange = library.on('change', run);
        const offProgress = library.on('progress', ({ detail }) => {
          const phase = { download: L('lib.downloading'), convert: L('lib.converting'), validate: L('lib.validating'), write: L('lib.saving') }[detail.phase];
          progress.set(detail.identify, detail.received ? `${phase} ${formatBytes(detail.received)}` : `${phase}…`);
          run();
        });
        run();
        return () => { disposed = true; repaint = () => {}; offChange(); offProgress(); };
      },
    });
  },
};
