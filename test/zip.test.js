/**
 * The zip reader, tested against zips this build did not write.
 *
 * A reader tested only against its own writer is a reader that agrees with
 * itself. So the fixtures here are made with the platform's own deflate — the
 * compressed path, which is what a real archive uses and what our writer never
 * produces — as well as with `makeZip`.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { gzipText, makeDeflatedZip, makeZip, openZip } from '../app/services/zip.js';

const encoder = new TextEncoder();

async function deflate(text) {
  const stream = new Blob([encoder.encode(text)]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zip built by hand, with one deflated entry and one stored. */
async function handMade() {
  const files = [
    { name: 'meta.xml', body: encoder.encode('<meta/>'), method: 0 },
    { name: 'deep/big.usfx.xml', body: await deflate(LONG), method: 8, size: encoder.encode(LONG).byteLength },
  ];
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, file.method, true);
    lv.setUint32(18, file.body.byteLength, true);
    lv.setUint32(22, file.size ?? file.body.byteLength, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    parts.push(local, file.body);

    const head = new Uint8Array(46 + name.byteLength);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(10, file.method, true);
    hv.setUint32(20, file.body.byteLength, true);
    hv.setUint32(24, file.size ?? file.body.byteLength, true);
    hv.setUint16(28, name.byteLength, true);
    hv.setUint32(42, offset, true);
    head.set(name, 46);
    central.push(head);
    offset += local.byteLength + file.body.byteLength;
  }
  const directory = central.reduce((n, c) => n + c.byteLength, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...parts, ...central, end]).arrayBuffer());
}

const LONG = `<usfx>${'<v id="1"/>In the beginning God created the heaven and the earth.'.repeat(400)}</usfx>`;

test('a deflated archive is read entry by entry, and only when asked', async () => {
  const zip = openZip(await handMade());
  assert.deepEqual(zip.map((e) => e.name), ['meta.xml', 'deep/big.usfx.xml']);
  assert.equal(await zip[0].text(), '<meta/>', 'a stored entry');
  const big = await zip[1].text();
  assert.equal(big, LONG, 'and a deflated one, byte for byte');
  assert.ok(zip[1].compressed < zip[1].size, 'which really was compressed');
});

test('what this build writes, this build reads', async () => {
  const blob = makeZip([
    { name: '01-GEN-fix.usfm', text: '\\id GEN\n\\c 1\n\\v 1 In the beginning.\n' },
    { name: '19-PSA-fix.usfm', text: '\\id PSA\n\\c 23\n\\v 1 The LORD is my shepherd.\n' },
  ]);
  const zip = openZip(await blob.arrayBuffer());
  assert.equal(zip.length, 2);
  assert.match(await zip[0].text(), /In the beginning/);
  assert.match(await zip[1].text(), /my shepherd/);
  assert.ok(blob.size > 100);
  assert.equal(blob.type, 'application/zip');
});

test('text is decoded as UTF-8, whatever script it is in', async () => {
  const blob = makeZip([{ name: 'my.txt', text: 'ကမ္ဘာဦးကျမ်း ၁:၁ — الكتاب المقدس' }]);
  const [entry] = openZip(await blob.arrayBuffer());
  assert.equal(await entry.text(), 'ကမ္ဘာဦးကျမ်း ၁:၁ — الكتاب المقدس');
});

test('something that is not a zip says so, and a broken entry names itself', async () => {
  assert.throws(() => openZip(encoder.encode('I am a USFM file, not an archive.')), /not a zip archive/);
  // An entry compressed some other way is refused by name rather than read as
  // rubbish: bzip2 is method 12, and somebody's archive will be.
  const bytes = await handMade();
  const view = new DataView(bytes.buffer);
  // The central directory's method field for the first entry.
  const central = view.getUint32(bytes.byteLength - 6, true);
  view.setUint16(central + 10, 12, true);
  const [entry] = openZip(bytes);
  await assert.rejects(() => entry.text(), /cannot read \(method 12\)/);
});

test('a compressed export is smaller and reads back the same', async () => {
  const long = 'In the beginning God created the heaven and the earth. '.repeat(400);
  const plain = makeZip([{ name: 'a.txt', text: long }]);
  const small = await makeDeflatedZip([{ name: 'a.txt', text: long }, { name: 'ကမ္ဘာ.txt', text: 'ကမ္ဘာဦး' }]);
  assert.ok(small.size < plain.size / 4, `deflated ${small.size} bytes against ${plain.size} stored`);
  const zip = openZip(await small.arrayBuffer());
  assert.deepEqual(zip.map((e) => e.name), ['a.txt', 'ကမ္ဘာ.txt'], 'a Burmese name survives');
  assert.equal(await zip[0].text(), long);
  assert.equal(await zip[1].text(), 'ကမ္ဘာဦး');
});

test('gzip is a real gzip stream', async () => {
  const blob = await gzipText('The LORD is my shepherd; I shall not want.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([bytes[0], bytes[1]], [0x1f, 0x8b], 'the gzip magic number');
  const back = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.equal(back, 'The LORD is my shepherd; I shall not want.');
});
