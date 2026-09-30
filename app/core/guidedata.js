/**
 * Guide data: answers the guide can download, one topic to a file.
 *
 * ## Where
 *
 * In the catalog repository, under `guide/`, one folder per language and any
 * folders under that a person finds useful:
 *
 *   guide/en/help/bookmarks.json
 *   guide/en/books/43-john.json
 *   guide/nb/help/bookmarks.json
 *
 * Every file under `guide/` that is not Markdown is data; a Markdown file is
 * for people (a README saying how to write one). There is no index: the app
 * asks GitHub for the repository's file list and takes what is under
 * `guide/<language>/`. The language is the folder, not a field a file could
 * contradict.
 *
 * ## What
 *
 * A file is a schema.org FAQPage in JSON-LD — the format websites already use
 * to publish questions and answers, so any JSON-LD or schema.org tool reads it:
 *
 *   {
 *     "@context": "https://schema.org",
 *     "@type": "FAQPage",
 *     "name": "Bookmarks",
 *     "inLanguage": "en",
 *     "dateModified": "2026-09-30",
 *     "mainEntity": [
 *       {
 *         "@type": "Question",
 *         "name": "How do I bookmark a verse?",
 *         "alternateName": ["mark a verse", "save a verse"],
 *         "acceptedAnswer": { "@type": "Answer", "text": "Press a verse number, …" },
 *         "potentialAction": { "@type": "Action", "target": "laisiangtho:pane/marks" }
 *       }
 *     ]
 *   }
 *
 * `alternateName` is the other ways somebody might ask, and `potentialAction`
 * the button the answer offers. Its target is one of:
 *
 *   laisiangtho:command/<command id>     run a command
 *   laisiangtho:doc/<document id>        open a document
 *   laisiangtho:pane/<pane id>           show a sidebar pane
 *   laisiangtho:palette/<text>           open the palette with the text typed
 *   laisiangtho:passage/<book>/<chapter>[/<verse>]   go to a passage
 *
 * Everything else schema.org allows is accepted and ignored. What this app
 * needs is checked, and a file that lacks it is refused with the path and the
 * reason — a question without an answer is not half an entry.
 */

const TARGET = /^laisiangtho:(command|doc|pane|palette|passage)\/(.+)$/;

/** Paths of guide data among a repository's files: under guide/<lang>/, not Markdown. */
export function guidePaths(paths) {
  return paths.filter((path) => /^guide\/[a-z]{2,3}(-[A-Za-z0-9]+)?\/.+\.(json|jsonld)$/i.test(path));
}

/** Paths under guide/ that are neither Markdown nor data: said, not skipped silently. */
export function strayPaths(paths) {
  return paths.filter((path) => path.startsWith('guide/') && !/\.md$/i.test(path) && !guidePaths([path]).length);
}

/** "guide/en/help/x.json" → "en" */
export const languageOfPath = (path) => path.split('/')[1];

/** The action a target names, as the guide's `does`, or null for no button. */
export function actionOf(target, where) {
  if (target === undefined || target === null) return null;
  const found = TARGET.exec(String(target));
  if (!found) throw new Error(`${where}: potentialAction target must be laisiangtho:command|doc|pane|palette|passage/…, got ${JSON.stringify(target)}`);
  const [, kind, rest] = found;
  if (kind === 'command') return { cmd: rest };
  if (kind === 'doc') return { doc: rest };
  if (kind === 'pane') return { pane: rest };
  if (kind === 'palette') return { palette: `${decodeURIComponent(rest)} ` };
  const [book, chapter, verse] = rest.split('/').map(Number);
  if (!Number.isInteger(book) || book < 1 || !Number.isInteger(chapter) || chapter < 1 || (verse !== undefined && (!Number.isInteger(verse) || verse < 1))) {
    throw new Error(`${where}: passage target must be laisiangtho:passage/<book>/<chapter>[/<verse>], got ${JSON.stringify(target)}`);
  }
  return { passage: { book, chapter, verse: verse ?? null } };
}

const asList = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * One file's entries.
 *
 * @param {unknown} json the parsed file
 * @param {string} path where it came from, for ids and for errors
 * @returns {{ topic: string, lang: string, modified: string|null,
 *             entries: { id: string, title: string, text: string, phrases: string[], does: object|null, topic: string, lang: string }[] }}
 * @throws {Error} naming the path and what is wrong
 */
export function parseGuideFile(json, path) {
  const lang = languageOfPath(path);
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`${path}: expected a JSON object`);
  const type = asList(json['@type']);
  if (!type.includes('FAQPage')) throw new Error(`${path}: expected "@type": "FAQPage", got ${JSON.stringify(json['@type'])}`);
  const context = String(json['@context'] ?? '');
  if (!/^https?:\/\/schema\.org\/?$/.test(context)) throw new Error(`${path}: expected "@context": "https://schema.org"`);
  const topic = text(json.name);
  if (!topic) throw new Error(`${path}: the page needs a "name" — the topic, as a person would call it`);
  if (json.inLanguage !== undefined && text(json.inLanguage) && text(json.inLanguage).split('-')[0] !== lang.split('-')[0]) {
    throw new Error(`${path}: inLanguage "${json.inLanguage}" disagrees with its folder "${lang}"`);
  }
  const questions = asList(json.mainEntity);
  if (!questions.length) throw new Error(`${path}: "mainEntity" has no questions`);
  const entries = questions.map((q, i) => {
    const where = `${path} mainEntity[${i}]`;
    if (!q || typeof q !== 'object' || !asList(q['@type']).includes('Question')) throw new Error(`${where}: expected a "@type": "Question"`);
    const title = text(q.name);
    if (!title) throw new Error(`${where}: the question needs a "name"`);
    const answer = asList(q.acceptedAnswer)[0];
    const body = text(answer?.text);
    if (!body) throw new Error(`${where}: "acceptedAnswer" needs a "text"`);
    const phrases = asList(q.alternateName).map(text).filter(Boolean);
    const actions = asList(q.potentialAction);
    const does = actions.length ? actionOf(actions[0]?.target, where) : null;
    const stem = path.replace(/^guide\//, '').replace(/\.(json|jsonld)$/i, '');
    // A number in the topic ("1 John", "2 Kings") is part of what it is.
    const must = topic.match(/\d+/g) ?? [];
    return { id: `data:${stem}#${i + 1}`, title, text: body, phrases: [topic, ...phrases], does, topic, lang, must };
  });
  const modified = text(json.dateModified) || null;
  return { topic, lang, modified, entries };
}
