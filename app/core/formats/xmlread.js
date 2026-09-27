/**
 * A small XML reader, because the two that exist are both out of reach.
 *
 * `DOMParser` belongs to a window, and importing happens in a worker — the
 * whole point of doing it there is that a 30 MB file must not stop the reader
 * scrolling. `app/core/` is also pure by rule, and a parser that can only be
 * tested inside a browser is a parser that will not be tested. So this is a
 * pull reader over a string: it emits opening tags, closing tags and text, and
 * nothing else.
 *
 * What it handles, because Bible XML in the wild contains it: attributes in
 * either quote, self-closing tags, comments, processing instructions, doctype
 * declarations, CDATA sections, the five predefined entities and numeric
 * character references. What it does not handle, because no Bible file needs
 * it: namespace resolution (a prefix is part of the name, and the callers match
 * on the local name), external entities, and validation of any kind.
 *
 * It is a reader, not a validator: malformed input yields whatever can be read
 * from it rather than an error. The file's *meaning* is checked later, by
 * `parseTranslation` against the canon, which is the check that matters — an
 * XML file can be perfectly well-formed and still not be a Bible.
 */

/**
 * @typedef {{ kind: 'open', name: string, attrs: Record<string,string>, empty: boolean }
 *          | { kind: 'close', name: string }
 *          | { kind: 'text', text: string }} XmlEvent
 */

const NAME = /[^\s/>]+/y;

/**
 * Walk a document, calling `visit` with each event in order.
 *
 * @param {string} source
 * @param {(event: XmlEvent) => void} visit
 */
export function readXml(source, visit) {
  const text = String(source ?? '');
  let at = 0;
  let run = '';

  const flush = () => {
    if (!run) return;
    const decoded = decodeEntities(run);
    run = '';
    if (decoded.trim() || decoded.includes(' ')) visit({ kind: 'text', text: decoded });
  };

  while (at < text.length) {
    const open = text.indexOf('<', at);
    if (open === -1) { run += text.slice(at); break; }
    run += text.slice(at, open);

    // The things that look like tags and are not.
    if (text.startsWith('<!--', open)) { at = skipTo(text, open + 4, '-->'); continue; }
    if (text.startsWith('<?', open)) { at = skipTo(text, open + 2, '?>'); continue; }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      run += text.slice(open + 9, end === -1 ? text.length : end);
      at = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<!', open)) { at = skipDoctype(text, open); continue; }

    const close = text.indexOf('>', open);
    if (close === -1) { run += text.slice(open); break; }
    const raw = text.slice(open + 1, close);
    at = close + 1;

    if (raw.startsWith('/')) {
      flush();
      visit({ kind: 'close', name: raw.slice(1).trim().toLowerCase() });
      continue;
    }

    NAME.lastIndex = 0;
    const found = NAME.exec(raw);
    if (!found) continue;
    flush();
    const empty = raw.endsWith('/');
    visit({
      kind: 'open',
      name: found[0].toLowerCase(),
      attrs: readAttrs(raw.slice(found[0].length, empty ? raw.length - 1 : raw.length)),
      empty,
    });
  }
  flush();
}

/** Past a doctype, including any internal subset in brackets. */
function skipDoctype(text, open) {
  let depth = 0;
  for (let i = open + 2; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    else if (ch === '>' && depth <= 0) return i + 1;
  }
  return text.length;
}

function skipTo(text, from, marker) {
  const end = text.indexOf(marker, from);
  return end === -1 ? text.length : end + marker.length;
}

const ATTR = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function readAttrs(source) {
  const attrs = {};
  if (!source.trim()) return attrs;
  ATTR.lastIndex = 0;
  let found = ATTR.exec(source);
  while (found) {
    attrs[found[1].toLowerCase()] = decodeEntities(found[3] ?? found[4] ?? found[5] ?? '');
    found = ATTR.exec(source);
  }
  return attrs;
}

const NAMED = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

/** The five predefined entities, one convenience, and numeric references. */
export function decodeEntities(value) {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X'
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    // An unreadable reference stays as it was written: mangling it into a
    // replacement character would hide a real problem in somebody's file.
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(code);
    } catch {
      return whole;
    }
  });
}

/** The local part of a possibly-prefixed name: `osis:verse` is `verse`. */
export function localName(name) {
  const at = name.indexOf(':');
  return at === -1 ? name : name.slice(at + 1);
}
