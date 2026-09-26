/**
 * A passage, written out: as Markdown to paste into a document, as a citation
 * to drop into a paragraph, and as a printable sheet.
 *
 * Reading a passage is one thing; using it is another. A sermon, an essay and a
 * study sheet all want the same text in a different shape, and each of them
 * wants the reader's own notes beside it — which is the part no Bible site can
 * give them, and the reason this is worth building rather than leaving to
 * copy-and-paste.
 *
 * Pure: it is handed the verses, the notes and the names, and returns a string.
 * Nothing here knows where any of it came from.
 */

/**
 * @typedef {{ verse: number, label: string, text: string, title?: string|null,
 *             marked?: boolean }} Line
 * @typedef {{ reference: string, translation: string|null, lines: Line[],
 *             notes?: { label: string, text: string }[],
 *             url?: string|null, retrieved?: string|null }} Passage
 */

/**
 * Markdown, with the verse numbers kept as superscript-ish markers rather than
 * headings: the passage has to read as prose when it lands in someone's
 * document, and a heading per verse does not.
 *
 * @param {Passage} passage
 * @param {{ numbers?: boolean, notes?: boolean }} options
 */
export function toMarkdown(passage, { numbers = true, notes = true } = {}) {
  const out = [`## ${passage.reference}`, ''];
  if (passage.translation) out.push(`*${passage.translation}*`, '');
  for (const line of passage.lines) {
    if (line.title) out.push(`**${line.title}**`, '');
    const body = numbers ? `**${line.label}** ${line.text}` : line.text;
    out.push(`> ${line.marked ? `==${body}==` : body}`, '>');
  }
  // The blockquote's trailing marker is dropped: it is a separator between
  // verses, not a line of its own.
  if (out.at(-1) === '>') out.pop();
  if (notes && passage.notes?.length) {
    out.push('', `### ${passage.notes.length === 1 ? 'Note' : 'Notes'}`, '');
    for (const note of passage.notes) {
      out.push(`**${note.label}**`, '', note.text.trim(), '');
    }
  }
  if (passage.url) {
    out.push('', `[${passage.reference}](${passage.url})`);
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/**
 * One paragraph with the reference after it — what goes inside a piece of
 * writing rather than beside it. Verse numbers become the separators, because a
 * quotation that keeps its line breaks is a block, not a citation.
 *
 * @param {Passage} passage
 */
export function toCitation(passage) {
  const body = passage.lines
    .map((line, i) => (i === 0 || passage.lines.length === 1 ? line.text : `${line.label} ${line.text}`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const source = passage.translation ? `${passage.reference} (${passage.translation})` : passage.reference;
  return `“${body}” — ${source}`;
}

/**
 * A sheet to print or hand out: the passage large enough to read from, the
 * reader's notes under it, and room in the margin for a pen.
 *
 * Returned as a whole document because it is printed on its own, not inside the
 * app. The styles are inline for the same reason.
 *
 * @param {Passage} passage
 * @param {{ title?: string }} options
 */
export function toPrintable(passage, { title = passage.reference } = {}) {
  const rows = passage.lines.map((line) => `${line.title ? `<h3>${escapeHtml(line.title)}</h3>` : ''}
      <p class="v${line.marked ? ' m' : ''}"><b>${escapeHtml(line.label)}</b> ${escapeHtml(line.text)}</p>`).join('\n');
  const notes = passage.notes?.length
    ? `<section class="notes"><h2>Notes</h2>${passage.notes.map((note) => `
      <article><h4>${escapeHtml(note.label)}</h4><p>${escapeHtml(note.text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p></article>`).join('')}</section>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 22mm 18mm; }
  body { font: 12pt/1.6 Georgia, "Times New Roman", serif; color: #111; max-width: 34em; margin: 0 auto; }
  h1 { font: 600 17pt/1.3 system-ui, sans-serif; margin: 0 0 2pt; }
  .src { font: 10pt/1.4 system-ui, sans-serif; color: #555; margin: 0 0 16pt; }
  h3 { font: 600 11pt/1.4 system-ui, sans-serif; margin: 14pt 0 4pt; color: #333; }
  p.v { margin: 0 0 7pt; }
  p.v b { font: 600 8.5pt system-ui, sans-serif; color: #777; vertical-align: 2pt; margin-right: 3pt; }
  p.v.m { background: #fff6c2; }
  .notes { margin-top: 20pt; border-top: 1px solid #ccc; padding-top: 10pt; }
  .notes h2 { font: 600 11pt system-ui, sans-serif; margin: 0 0 8pt; }
  .notes h4 { font: 600 10pt system-ui, sans-serif; margin: 10pt 0 2pt; color: #444; }
  .notes p { font: 10.5pt/1.55 Georgia, serif; margin: 0 0 6pt; }
  @media print { a[href]::after { content: ""; } }
</style></head>
<body>
  <h1>${escapeHtml(passage.reference)}</h1>
  <p class="src">${escapeHtml(passage.translation ?? '')}</p>
  ${rows}
  ${notes}
</body></html>
`;
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
