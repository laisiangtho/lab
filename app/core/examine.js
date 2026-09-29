/**
 * Looking a translation over, one chapter at a time.
 *
 * The record written at install carries counts — 272 merges, 49 chapters a
 * different length — and a list of findings capped at 400, because a
 * translation missing most of the canon would otherwise put thousands of them
 * in a row nobody reads. Counts answer "is anything wrong"; they cannot answer
 * "where", which is the only question worth asking next.
 *
 * Where is in the chapters, and the chapters are already on this device. So
 * this is a single pass over them, and it is one pass rather than three
 * because the three questions are asked of the same rows:
 *
 *   against the canon   every finding, uncapped, computed now rather than read
 *                       from a snapshot that was truncated
 *   merged verses       which verse covers which, and where
 *   headings            how much of the translation has any, and what is bare
 *
 * Pure: it is handed rows and hands back findings. The store walks the cursor,
 * the shell draws the result, and this can be tested with three objects.
 *
 * The canon rules live here rather than in `translation.js` so that the check
 * made at install and the check made later are the same code. Two copies of a
 * versification rule is two answers to one question.
 */

/**
 * The last verse a chapter covers, counting a merge as reaching its far end:
 * a chapter whose verse 17 is written `17-18` covers 18, and reporting it as
 * one short is the importer's fault rather than the edition's.
 */
export function lastCoveredVerse(verses) {
  let max = 0;
  for (const [key, verse] of Object.entries(verses)) {
    max = Math.max(max, Number(verse?.merge ?? 0) || Number(key));
  }
  return max;
}

/**
 * How one chapter stands against the canon, or null when it agrees with it.
 * @param {object} category
 * @param {number} book
 * @param {number} chapter
 * @param {object} verses
 */
export function chapterAgainstCanon(category, book, chapter, verses) {
  if (!category.hasBook(book)) return null;
  const canon = category.book(book);
  if (chapter > canon.chapters) {
    return { type: 'extra-chapter', book, chapter, expected: canon.chapters };
  }
  const expected = canon.verses[chapter - 1];
  const actual = lastCoveredVerse(verses);
  return actual === expected ? null : { type: 'versification', book, chapter, expected, actual };
}

/**
 * @param {{ category: object, story?: object, limit?: number }} options
 *        `story` is the translation's pericope headings, which live on the
 *        record rather than in the chapters — a chapter with no title of its
 *        own may still be headed, and counting it as bare would be wrong.
 *        `limit` caps each list so a badly broken file cannot fill memory with
 *        its own faults; the counts stay exact whatever the lists hold.
 */
export function createExamination({ category, story = {}, limit = 5000 }) {
  const canon = [];
  const merges = [];
  const bare = [];
  const headings = [];
  const seen = new Set();
  const count = {
    chapters: 0, verses: 0, merges: 0, stories: 0, titles: 0, headed: 0,
    missing: 0, short: 0, extra: 0,
  };

  const keep = (list, item) => { if (list.length < limit) list.push(item); };

  return {
    /** @param {{ book: number, chapter: number, verses: object }} row */
    visit(row) {
      const { book, chapter, verses } = row;
      if (!verses) return;
      seen.add(book);
      count.chapters += 1;

      const finding = chapterAgainstCanon(category, book, chapter, verses);
      if (finding) {
        keep(canon, finding);
        count[finding.type === 'extra-chapter' ? 'extra' : 'short'] += 1;
      }

      const pericopes = story?.[book]?.[chapter] ?? null;
      let headed = pericopes ? Object.keys(pericopes).length : 0;
      count.stories += headed;
      let here = headed;

      for (const key of Object.keys(verses)) {
        const verse = verses[key];
        count.verses += 1;
        if (verse?.title) { count.titles += 1; headed += 1; here += 1; }
        const to = Number(verse?.merge ?? 0);
        const from = Number(key);
        if (to > from) {
          count.merges += 1;
          keep(merges, { book, chapter, verse: from, to, span: to - from + 1 });
        }
      }

      if (here) headings.push({ book, chapter, n: here });
      if (headed) count.headed += 1;
      else keep(bare, { book, chapter });
    },

    /**
     * What the pass found. Missing books are answered here rather than per
     * chapter: a book is missing by never having been visited, which is only
     * knowable once the walk is over.
     */
    report(meta = null) {
      const missing = category.books.filter((b) => !seen.has(b.id)).map((b) => b.id);
      count.missing = missing.length;
      const all = [
        ...missing.map((book) => ({ type: 'missing-book', book })),
        ...canon,
      ];
      return {
        canon: all.slice(0, limit),
        merges: [...merges].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse),
        bare,
        books: seen.size,
        count: { ...count, total: count.missing + count.short + count.extra },
        // A list that was cut says so, so a reader is never told there are
        // forty when the pass stopped counting them at forty.
        capped: canon.length >= limit || merges.length >= limit || bare.length >= limit,
        // `books` above is how many the file holds; this is what to say about each.
        byBook: groupByBook({ category, meta, seen, canon: all, merges, headings }),
      };
    },
  };
}

/**
 * The headings a translation carries, as one list in canon order.
 *
 * Both kinds are one list on purpose: `story` is a pericope heading and
 * `verse.title` is a sub-heading, and to a reader looking for where a passage
 * begins that distinction is a detail — kept as `level` for anyone who wants
 * to draw them differently, never as two lists to search separately.
 *
 * @param {{ story?: object, verses?: object, book: number, chapter: number }} at
 * @returns {{ book: number, chapter: number, verse: number, text: string, level: 1|2 }[]}
 */
export function headingsOf({ story = null, verses = null, book, chapter }) {
  const out = [];
  const keys = new Set([
    ...Object.keys(story ?? {}),
    ...Object.keys(verses ?? {}).filter((k) => verses[k]?.title),
  ].map(Number));
  for (const verse of [...keys].sort((a, b) => a - b)) {
    const pericope = story?.[verse];
    if (pericope?.text) out.push({ book, chapter, verse, text: pericope.text, level: 1 });
    const title = verses?.[verse]?.title;
    if (title) out.push({ book, chapter, verse, text: title, level: 2 });
  }
  return out;
}

/**
 * One row per book of the canon, with what there is to say about it.
 *
 * The report used to have a section per kind of finding — differences here,
 * merges there, headings somewhere else — which asks the reader to hold three
 * lists in their head to answer one question: *what about Isaiah?* A book is
 * the unit somebody actually works in, so a book is the row, and the kinds are
 * three numbers on it: merges, headings, lengths that disagree.
 *
 * `null` for a count means *not known yet* rather than none: before the pass
 * has run, the record can say which books are missing and which chapters were
 * recorded as a different length, and nothing at all about merges or headings.
 *
 * @param {{ category: object, meta?: object|null, seen?: Set<number>|null,
 *           canon?: object[], merges?: object[]|null, headings?: object[]|null }} input
 */
export function groupByBook({ category, meta = null, seen = null, canon = [], merges = null, headings = null }) {
  const rows = new Map();
  for (const book of category.books) {
    rows.set(book.id, {
      id: book.id,
      name: meta?.books?.[book.id]?.name || book.name,
      english: book.name,
      desc: meta?.books?.[book.id]?.desc ?? '',
      present: seen ? seen.has(book.id) : Boolean(meta?.books?.[book.id]),
      merges: merges ? 0 : null,
      headings: headings ? 0 : null,
      lengths: 0,
      chapters: new Map(),
    });
  }

  /** The row for a chapter of a book, made when something first lands on it. */
  const at = (book, chapter) => {
    const row = rows.get(book);
    if (!row) return null;
    if (!row.chapters.has(chapter)) {
      row.chapters.set(chapter, { chapter, merges: [], headings: 0, length: null });
    }
    return row.chapters.get(chapter);
  };

  for (const finding of canon) {
    const row = rows.get(finding.book);
    if (!row || finding.type === 'missing-book') continue;
    const chapter = at(finding.book, finding.chapter);
    if (!chapter) continue;
    chapter.length = finding;
    row.lengths += 1;
  }
  for (const merge of merges ?? []) {
    const chapter = at(merge.book, merge.chapter);
    if (!chapter) continue;
    chapter.merges.push(merge);
    rows.get(merge.book).merges += 1;
  }
  for (const heading of headings ?? []) {
    const chapter = at(heading.book, heading.chapter);
    if (!chapter) continue;
    chapter.headings += heading.n;
    rows.get(heading.book).headings += heading.n;
  }

  return [...rows.values()].map((row) => ({
    ...row,
    chapters: [...row.chapters.values()].sort((a, b) => a.chapter - b.chapter),
  }));
}
