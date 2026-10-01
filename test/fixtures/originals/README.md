# Original-language fixtures

Small, real extracts used to test the importers against files as they are
published, not as a test would imagine them.

- `wlc-gen1-1-5.osis.xml` — Genesis 1:1–5 from the Westminster Leningrad
  Codex with OpenScriptures Hebrew Bible lemmas and morphology, as shipped
  with browserBible-3 (`input/wlc/Gen.xml`). WLC text: public domain. OSHB
  lemma and morphology data: CC BY 4.0, Open Scriptures
  (https://github.com/openscriptures/morphhb).
- `tbesh-extract.txt` — the header and a handful of entries (H0001, H0430,
  H0853, H1254a/b, H7225, H9001) of STEPBible's Translators Brief lexicon of
  Extended Strongs for Hebrew, CC BY 4.0, STEPBible.org
  (https://github.com/STEPBible/STEPBible-Data).
- `strongs-hebrew-dictionary-extract.js`, `strongs-greek-dictionary-extract.js`
  — a few entries (H1, H430, H853, H1254, H7225, H8674; G26, G1510, G2316,
  G3588, G5624) of Open Scriptures' JSON edition of Strong's dictionaries,
  with its header. Strong's text: public domain; the JSON edition: CC BY-SA,
  Open Scriptures (https://github.com/openscriptures/strongs). G2316 is in it
  because its definition is one of those the edition files with the
  derivation, which `scripts/lexicon.mjs` puts back.
- `wlc-mal3.osis.xml` — Malachi 3 (Hebrew numbering, 24 verses: English
  4:1–6 is 3:19–24) of the Westminster Leningrad Codex with OSHB lemmas, as
  shipped with browserBible-3 (`input/wlc/Mal.xml`). Public domain; OSHB
  lemma data CC BY 4.0.
- `kjv-mal4.osis.xml` — Malachi 4 of the KJV with Strong's numbers, as
  shipped with browserBible-3 (`input/kjv2006/kjv.xml`), with that file's
  header. Public domain. Together with the WLC extract, the test that the
  word study and the interlinear line read English 4:1 against Hebrew 3:19.
