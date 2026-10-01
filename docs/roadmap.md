# Roadmap

What is planned, in the order it is worth doing. Each item says why it matters
and what "done" means, so it can be picked up cold. Items marked **decide**
need an architecture discussion before any code: they change what the app
stores, fetches or promises.

Last reviewed at 26.10.01.3.

---

## Now — gaps a reader can hit today

1. **Publish the lexicons the app already asks for.**
   `config.lexiconUrl` points at `lexicon/strongs-{h,g}.json` in the catalog
   repository, which does not exist yet (404 on 1 October 2026), so the
   popover's *Fetch the Hebrew lexicon* fails for every reader who has not
   imported TBESH/TBESG by hand.
   Done when: a stdlib script (`scripts/lexicon.mjs`, dry run by default)
   converts STEPBible's TBESH and TBESG into the app's lexicon JSON with the
   CC BY attribution in its header, the two files are in the catalog
   repository, and an e2e test fetches one through the harness.

2. **Versification between a translation and its original.**
   The word study and the interlinear line match verses by number. Where the
   Hebrew numbers differently — Malachi 4 is Hebrew 3:19–24, Joel 2–3, the
   psalm titles that are verse 1 in Hebrew, chapter breaks in Numbers and
   Isaiah — the original shown is the wrong verse.
   Done when: a mapping (STEPBible's TVTMS, CC BY, is the candidate) is
   generated into a pure core table, `verseWords` and the interlinear line go
   through it, and Malachi 4:1 shows Hebrew 3:19 in a test.

3. **A Greek original, tested.** Only Hebrew has gone through the import,
   word study and interlinear line end to end. Robinson's codes, the Greek
   lexicon path and `G` numbers in the KJV New Testament have unit tests only.
   Done when: a trimmed Greek New Testament fixture (an eBible.org browserBible
   or USFX text with Strong's numbers) runs through the same e2e steps as the
   Hebrew one.

4. **Burmese review.** Every Burmese interface string, including the word
   study, interlinear and Help topics added in 26.10.01.1, was written without
   a native reader's check. Settings marks the language as *review*.
   Done when: a native reader has gone through `locales/my.js` and the mark is
   removed.

5. **Strong's tense codes.** The KJV's morphology is `strongMorph:TH8804`,
   which the word study shows as a raw code.
   Done when: the TH/TG table (published with the tagged KJV texts; its licence to be checked first) is generated
   into `morph-data.js` and `describeMorph` reads it.

## Next — deeper study

6. **Show what corresponds.** Resting on a word in the translation marks the
   original word with the same number in the interlinear line, and the
   reverse. The data is already on screen (`data-codes` on both); this is
   presentation only.

7. **Word study across translations.** Today the renderings are those of the
   translation being read. A tab comparing every tagged translation on the
   device ("H2617: lovingkindness 30, mercy 149, steadfast love …") is the
   same index, built per translation.

8. **The original's own concordance.** Every place the Hebrew or Greek word
   occurs in the original, with its form in each, from the original's index —
   not only where the translation tagged it.

9. **Notes on a word.** A note can be filed against a Strong's number as well
   as a passage, and the word study lists them. **decide**: annotations are
   keyed on book/chapter/verse today; a second key is a schema change and an
   export-format change.

10. **Study packs.** A topical index, a Bible dictionary and cross-reference
    sets, downloaded like guide data and keyed by reference, so answers can
    quote the reader's own translation. **decide**: pack formats, licences of
    the sources, and where they are hosted.

11. **Guide data for the new features.** Downloadable answers in the catalog
    repository's `guide/` for word study, originals, interlinear and lexicons,
    in all three languages.

## Later — platform and quality

12. **Lazy panes.** Every pane is mounted at startup, including those not on
    show. Mounting on first show is the larger startup saving and changes
    behaviour for every reader, so it was left as its own change.

13. **Split the main bundle.** The main chunk is about 1 MB minified; features
    a reader may never open (the card studio, the board, the graph, export)
    can load the way the guide and word study do. Measure startup before and
    after with `npm run test:perf`.

14. **Measure the lemma index at full size.** Building it for a whole tagged
    Bible is estimated at a second or two and has not been measured. Add it
    to `test:perf`, and show progress in the pane if it is slow.

15. **Crawl in CI.** `npm run test:crawl` found real faults three releases
    running and only runs by hand. Run it nightly (scheduled workflow) and on
    release commits, with its screenshots as artifacts.

16. **Accessibility pass.** A screen-reader and keyboard-only walk through the
    card studio, the board, the graph and the word study, which the crawl's
    unnamed-button check covers only partly.

17. **Signed desktop builds.** macOS is ad-hoc signed and Windows unsigned, so
    both warn on first run. Needs a Developer ID and a code-signing
    certificate, kept as CI secrets. **decide**: cost and who holds the keys.

18. **Release metadata in the AppStream file.** `version.mjs` could stamp a
    `<release>` into `assets/linux/org.laisiangtho.app.metainfo.xml`, so
    software centres show the version and its date.

## Ideas that need a decision first

19. **Moving material between devices without a file.** Notes, bookmarks and
    projects travel only as an export today. Options run from a folder the
    desktop app watches (a synced folder the reader already has) to a hosted
    service. **decide**: the app has no account and no server, and that is a
    promise worth keeping.

20. **An interface in Zolai (Tedim)**, and any other language with a reader
    willing to check it. The string files and their parity test make a new
    language a translation job, not a code job.

21. **Audio.** eBible.org and others publish recorded audio for some
    translations; playing it verse by verse needs timing data most of them do
    not have. **decide**: which sources have verse timings, and their
    licences.

22. **A generative model with the reader's own key**, for questions the guide
    cannot answer. Deliberately not done: it needs a network and a trust the
    rest of the app does not ask for. **decide**.
