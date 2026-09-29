/**
 * Reading a zip, with nothing but what the platform already has.
 *
 * A translation as it is actually published is a zip. eBible.org hands out
 * `engkjvcpb_usfx.zip`, and inside it are the pieces that make the file worth
 * having: the scripture, the translation's own book names, its metadata, its
 * copyright notice. Asking somebody to unpack it and then feed us one file out
 * of eight is asking them to do our job.
 *
 * There is no dependency here and there does not need to be. A zip's central
 * directory is a few fixed-width fields, and `DecompressionStream('deflate-raw')`
 * — in every current browser, in Node, and in a worker — does the inflating.
 * What is left is about a hundred lines of reading little-endian integers.
 *
 * This lives in `services/` rather than `core/` because it is asynchronous and
 * built on a platform stream; it is still testable in Node, which is where its
 * tests run.
 *
 * What it does not do: encrypted entries, zip64 beyond the common case, and
 * compression methods other than store and deflate. Those are refused by name
 * rather than half-read.
 */

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * @typedef {{ name: string, size: number, compressed: number, method: number,
 *             at: number, text: () => Promise<string>,
 *             bytes: () => Promise<Uint8Array> }} ZipEntry
 */

/**
 * Open a zip held in memory.
 *
 * Nothing is inflated until an entry is asked for, so opening a 40 MB archive
 * to read one 14 KB metadata file costs the central directory and no more.
 *
 * @param {ArrayBuffer|Uint8Array} source
 * @returns {ZipEntry[]} the files, in the order the archive lists them
 */
export function openZip(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(bytes, view);

  const entries = [];
  let at = end.start;
  for (let i = 0; i < end.count; i += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL) break;
    const method = view.getUint16(at + 10, true);
    const flags = view.getUint16(at + 8, true);
    let compressed = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let offset = view.getUint32(at + 42, true);
    const name = text(bytes.subarray(at + 46, at + 46 + nameLength));

    // Zip64 puts the real numbers in an extra field when the 32-bit ones are
    // saturated — which any Bible bundle over 4 GB would be, and some are.
    if (size === 0xffffffff || compressed === 0xffffffff || offset === 0xffffffff) {
      const found = zip64(view, at + 46 + nameLength, extraLength, { size, compressed, offset });
      size = found.size;
      compressed = found.compressed;
      offset = found.offset;
    }

    entries.push(makeEntry({ bytes, view, name, method, flags, size, compressed, offset }));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function makeEntry({ bytes, view, name, method, flags, size, compressed, offset }) {
  const read = async () => {
    if (flags & 0x1) throw new Error(`${name}: this entry is encrypted`);
    if (view.getUint32(offset, true) !== LOCAL) throw new Error(`${name}: the archive points nowhere`);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const from = offset + 30 + nameLength + extraLength;
    const raw = bytes.subarray(from, from + compressed);
    if (method === 0) return raw;
    if (method !== 8) throw new Error(`${name}: compressed in a way this build cannot read (method ${method})`);
    return inflate(raw);
  };
  return {
    name,
    size,
    compressed,
    method,
    at: offset,
    bytes: read,
    text: async () => text(await read()),
  };
}

/** Where the central directory is, following the zip64 trail if there is one. */
function findEnd(bytes, view) {
  // The end record is at the tail, after a comment of up to 64 KiB.
  const from = Math.max(0, bytes.byteLength - 66_000);
  let at = -1;
  for (let i = bytes.byteLength - 22; i >= from; i -= 1) {
    if (view.getUint32(i, true) === EOCD) { at = i; break; }
  }
  if (at === -1) throw new Error('this file is not a zip archive');

  let count = view.getUint16(at + 10, true);
  let start = view.getUint32(at + 16, true);

  if (count === 0xffff || start === 0xffffffff) {
    const locator = at - 20;
    if (locator >= 0 && view.getUint32(locator, true) === EOCD64_LOCATOR) {
      const where = Number(view.getBigUint64(locator + 8, true));
      if (view.getUint32(where, true) === EOCD64) {
        count = Number(view.getBigUint64(where + 32, true));
        start = Number(view.getBigUint64(where + 48, true));
      }
    }
  }
  return { start, count };
}

/** The zip64 extra field: whichever of the three numbers were saturated. */
function zip64(view, at, length, fallback) {
  let cursor = at;
  const end = at + length;
  while (cursor + 4 <= end) {
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    if (id === 0x0001) {
      let field = cursor + 4;
      const out = { ...fallback };
      if (out.size === 0xffffffff) { out.size = Number(view.getBigUint64(field, true)); field += 8; }
      if (out.compressed === 0xffffffff) { out.compressed = Number(view.getBigUint64(field, true)); field += 8; }
      if (out.offset === 0xffffffff) { out.offset = Number(view.getBigUint64(field, true)); }
      return out;
    }
    cursor += 4 + size;
  }
  return fallback;
}

async function inflate(raw) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('this build of the browser cannot decompress a zip');
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const chunks = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

const text = (bytes) => new TextDecoder().decode(bytes);

/**
 * Write a zip. Stored, not compressed: an export is written once and read once,
 * and a deflate stream here would buy a few per cent on text that the reader's
 * own filesystem will compress anyway — at the cost of a compressor.
 *
 * @param {{ name: string, text: string }[]} files
 * @returns {Blob}
 */
export function makeZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const body = encoder.encode(file.text);
    const sum = crc32(body);

    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);         // version needed
    lv.setUint16(8, 0, true);          // stored
    lv.setUint32(14, sum, true);
    lv.setUint32(18, body.byteLength, true);
    lv.setUint32(22, body.byteLength, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    parts.push(local, body);

    const head = new Uint8Array(46 + name.byteLength);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, CENTRAL, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 20, true);
    hv.setUint16(10, 0, true);
    hv.setUint32(16, sum, true);
    hv.setUint32(20, body.byteLength, true);
    hv.setUint32(24, body.byteLength, true);
    hv.setUint16(28, name.byteLength, true);
    hv.setUint32(42, offset, true);
    head.set(name, 46);
    central.push(head);

    offset += local.byteLength + body.byteLength;
  }

  const directory = central.reduce((n, c) => n + c.byteLength, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
