# Study data fixtures

- `openbible-gen1-1-5.txt` — the cross-references of Genesis 1:1–5, in the
  layout OpenBible.info publishes (`cross_references.txt`: a header of
  "From Verse, To Verse, Votes" and the credit, then one tab-separated link a
  line, ranges as `Prov.8.22-Prov.8.30`). openbible.info cannot be reached
  from the machine these were made on, so the lines were rebuilt from the
  copy of the same data in github.com/lggcs/crossrefviz (`openbible.json`,
  which lists each verse of a range on its own), joining consecutive verses
  with the same votes back into ranges. The data: OpenBible.info, CC BY.
- `easton-a-extract.xml` — the header and the first six entries (A, Aaron,
  Aaronites, Abaddon, Abagtha, Abana) of Easton's Bible Dictionary (1897,
  public domain) in the Christian Classics Ethereal Library's ThML edition,
  as kept in github.com/neuu-org/bible-dictionary-dataset
  (`data/00_raw/ccel/xml/easton_ebd2.xml`).
- `topics-thml.xml` — four topics written for the tests in the layout of
  CCEL's ThML topical works (`<term>`, then `<def>` with `<scripRef
  osisRef>`). It is not CCEL's text: ccel.org cannot be reached from the
  machine these were made on, and no copy of Nave's ThML edition was found
  elsewhere, so the reader has not yet been tried on the real Nave's.
