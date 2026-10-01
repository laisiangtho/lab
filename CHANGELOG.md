# Changelog

Lai Siangtho is a Bible reader and study workspace for the web (an installable
PWA at laisiangtho.github.io) and the desktop (Windows, macOS, Linux), built
from one codebase. Versions are dates: `26.09.30.3` is the third build of
30 September 2026. Every release on GitHub is tagged `v` plus that version.

The first part lists what the application does. The second lists each release,
newest first.

---

## Features

### Reading

- Translations from the Lai Siangtho catalog (64 at present), downloaded once
  and read offline from then on; the catalog itself is checked for changes and
  a newer translation file is offered as an update.
- More translations from getBible and eBible.org, or from any web address or
  file, listed side by side in the Library; whatever is already on the device
  — under any source's name — is marked, so nothing is downloaded twice.
- Parallel reading: any number of translations side by side, levelled verse by
  verse — a translation that merges verses 17–18 stays level with one that
  does not — with synchronised scrolling that follows the verse.
- Books pane: testaments, books and a grid of chapters. It can follow the
  reading or be left entirely to the reader; a branch shut by hand stays shut.
- Every name in the translation's own language and script where it has one —
  books, testaments, chapter numbers in its own digits — with the English name
  on every control for anyone who cannot read the script.
- Scripts set properly: Burmese and Arabic get the line height and size they
  need, the reading surface carries the translation's `lang` and `dir`, and
  line breaking is left to the engine for scripts without spaces.
- Verse layouts (paragraph, list, continuous), text size, line height, line
  length and the interface's own size, all from the status bar.
- Section headings, verse titles and cross references; a reference opens where
  the reader is, previews on hover, or opens in a tab of its own.
- Strong's numbers from tagged editions, with a lexicon fetched on first use
  and kept for reading offline.
- Word study from a pressed word: the Hebrew or Greek word and its grammar
  (from an original the reader imported), the lexicon entry, and every word
  the translation uses for the number, with its verses.
- An interlinear line: the imported Hebrew or Greek under each verse, a word
  at a time with its gloss.
- Read aloud with the device's voices, including a voice in another language
  where the translation's language has none; the ribbon shows progress.
- Source view: any chapter as Markdown, this app's JSON, USFM, USX, OSIS,
  Zefania or a spreadsheet, beside the reading.

### Finding

- Command palette (Ctrl/⌘ P) and quick switcher (Ctrl/⌘ O) that read a
  reference as a reader would write it — `ps 23`, `1 jn 2:1-4`, or the same in
  the translation's own names and numerals.
- Palette verbs: `note`, `mark`, `find`, `parallel`, `export`, `card`,
  `project`, `go`, `copy`, each followed by a passage.
- Search in a worker across any set of translations and any part of the
  canon: plain words, whole words, or a regular expression, with or without
  case. Case and Latin accents fold (`etait` finds `était`) while Myanmar,
  Arabic and Hebrew marks are kept. Results stream in and report their shape —
  how many verses, chapters and books — before the list.

### Study

- Notes and bookmarks on a chapter, a verse or a run of verses, keyed on the
  passage so they follow the reader into every translation.
- Composer (Ctrl/⌘ J), a floating editor for notes in a small Markdown with
  `[[Genesis 1]]` wikilinks and `#tags`; all notes in one sortable table.
- Tags, backlinks, an outline of the chapter, and a link graph of the chapters
  the reader has touched.
- Reading plans (the whole Bible in a year, the New Testament in 90 days, the
  Gospels in 40, Psalms in 30), a verse of the day and a way back to where
  reading stopped.
- A reading streak, chapters this week, and how much of the Bible has been
  read.
- Memory verses with spaced practice and words hidden as a verse sticks.
- Any verse compared across every translation on the device, and a link that
  opens on a verse.
- Study board: verses and thoughts as cards on a canvas.
- Ink: freehand marking over the text, kept per chapter.
- Projects, as a studio: a sermon, a lesson or a series as an ordered list of
  passages, notes and tasks, quoted from whichever translation is open. One
  band to switch, rename and add; a stage that uses the width; exported as its
  own file or as Markdown.
- Cards: any passage drawn as an image in the script's own fonts, in a studio
  with direct manipulation, guides, undo, templates of the reader's own, and a
  warning when text and background are too close to read.
- Export a passage as Markdown, a citation, plain text, a file or a printed
  sheet; export and convert a whole translation, a testament or chosen books,
  as one file, gzipped, or a compressed zip — with or without Strong's
  numbers, headings and cross-references, with the reader's notes, compact or
  readable — always carrying the copyright.
- Help and a guide that answer questions about the app in the reader's own
  words, in English, Norwegian or Burmese, with the button that does what was
  asked — one knowledge, asked from the Help page, the Guide pane or `?` in
  the palette; it adapts to the answers a reader uses, on the device only.
- Import the reader's own translations — this app's JSON, USFM, USX, Zefania,
  OSIS, USFX, browserBible, a spreadsheet, or a whole eBible.org archive, with
  Strong's numbers and morphology kept — checked against the canon
  exactly as a published one is. Nothing is uploaded anywhere.
- A report on how each translation differs from the canon, and a way to look a
  translation over for faults.

### Workspace

- Tabs that reorder, detach into floating windows and dock back; parallel panes
  that swap; sidebars whose panes move between sides and rows; a ribbon the
  reader arranges. Everything reopens as it was left.
- Tabs and panes that do not fit go behind a `⋯` button that counts them.
- Dark and light themes, following the system or chosen, with an accent colour
  of the reader's own; text on the accent keeps its contrast in both themes.
- Interface in English, Norsk bokmål and Burmese, following the device or
  chosen in Settings.
- Phones and narrow windows: sidebars become drawers, the status bar becomes a
  floating navigation pill, and controls get room for a finger. Pages lay
  themselves out by the width of their pane, so a wide window with both
  sidebars open is handled like a narrow one.
- Settings, every one with a sentence saying what it does, exported and
  imported with the reader's notes, bookmarks and projects.
- Help (opening on a question), Shortcuts (generated from the commands),
  About, Data and formats, and a Welcome shown on the very first run.
- Nothing fails silently: a feature that cannot start is named, a full quota
  says what to do, an incomplete download offers Download again, and an app
  that cannot start offers Try again and Erase stored data.

### Desktop

- No title bar of its own: the tab band is the top of the window. On Windows
  and Linux the window buttons are drawn in the band's colours; on macOS the
  traffic lights sit inset in it. The empty end of the tab strip is the handle
  to move the window.
- Installers that need nothing else installed: Windows installer and portable
  executable; macOS disk image and zip for Apple silicon and Intel; Linux
  AppImage (no libfuse needed), `.deb`, `.rpm` and `.tar.gz`. Software centres
  list the app, so it uninstalls like any other.
- Update check against GitHub releases, once a day and on request.

### Web

- Installable, works offline, and waits for the reader to choose Reload before
  a new version takes over, so assets from two builds never mix.

### Releasing

- A commit whose message starts `release:web`, `release:desktop` or
  `release:all` builds, tests and publishes: the web build to
  laisiangtho.github.io, the installers to a GitHub release titled with the tag
  and described by the commits since the previous one.
- Release files are named `LaiSiangtho.<os>.<arch>.<ext>`, so each has a
  permanent link to the newest release, for example
  `https://github.com/laisiangtho/lab/releases/latest/download/LaiSiangtho.win.x64.exe`.

---

## Releases

### 26.10.01.2 — 1 October 2026

- The app describes itself in its listings: the web page and its install
  manifest carry a description and categories, and the Linux software-centre
  entry lists what the app does.
- The Library's empty "Yours" list names every format it reads, browserBible
  and USX included.
- README rewritten to open with what the app does and how to get it;
  `docs/roadmap.md` added.

### 26.10.01.1 — 1 October 2026

Hebrew and Greek, for reading closely:

- browserBible zips (eBible.org's `<id>_browserBible.zip`) are read: chapter
  pages, headings, poetry lines, Strong's numbers and morphology. The
  `index/` and `indexlemma/` folders are noted and not read — the app builds
  its own index from the text it keeps.
- Morphology codes are kept on import (OSIS, USFM, USX, Zefania,
  browserBible) and written back on export.
- STEPBible's lexicons, TBESH (Hebrew) and TBESG (Greek), import as files;
  a plain number finds its first sense and says which senses there are.
- Word study (right sidebar, "study H430" in the palette, or "Study this
  word" from a pressed word): the original word in that verse with its
  morphology written out, the lexicon entry, and the translation's words for
  the number with counts and verses. Each section says what is missing and
  where it comes from.
- Interlinear line (Reading → Show, or the palette).
- A word with several Strong's numbers shows them all, and the popover
  offers each.
- Help and the Guide are one knowledge in three views: Help in the
  workspace starts with a question and lays out every topic below; the Guide
  pane is the same answers as a conversation; "?" in the palette lists the
  answers as rows under the question.

Found by testing with real downloads:

- Fixed: a browserBible zip imported through the Library failed with
  "$.info.language.text: expected string"; the language typed in the dialog
  also lost the right-to-left direction info.json states.
- Fixed: the Strong's popover could show the word "null" where an entry had
  no transliteration or part of speech.


### 26.09.30.10 — 30 September 2026

Found by running every command, document and pane on a desktop (dark,
light, Norwegian) and a phone (English, Burmese), and every reading layout
with Strong's numbers on and off, one and two panes:

- Fixed: in the List layout, a word carrying a Strong's number stood on a
  line of its own, apart from its verse.
- Fixed: Ctrl/⌘ P while the quick switcher or any list was open fell
  through to the browser and opened the Print dialog; it now opens the
  palette in the list's place.
- Fixed: with the ribbon hidden, its "Add a button" control still hung,
  faded and pressable, off the top-left corner.
- Escape closes a sidebar drawer on a phone (and a phone's back gesture,
  where the browser sends it as Escape).
- A message about a setting replaces the last one about the same setting:
  "Strong's numbers: off" and "on" no longer stand one above the other.
- An empty note opens where it can be written, not in Preview.
- The Library's page and source buttons keep their names when their labels
  are hidden, for screen readers and tooltips.
- A language named in its own script is marked as that language, so it is
  drawn in a face for that script.
- The ribbon's setting described removing a button with an × that no longer
  exists; it now says to drag it to the bin.
- Data and formats says, in the reader's language, that its reference
  sections are in English and why, and marks them as English.

### 26.09.30.9 — 30 September 2026

- The Library takes the Cards page's shape: one band of tools, no title and
  no standing paragraph; storage and catalog facts are a readout with their
  detail in its tooltip.
- Fixed: Strong's numbers appeared as raw codes — `word{H430}` — on cards, in
  the verse of the day, in search results, in exported passages, in the word
  count and when a verse was read aloud. Only the reading surface shows them,
  and only when switched on.
- Numbers an edition uses past the end of Strong's lexicon, like the H9999
  that eBible.org's tagged Judson Bible puts on Burmese particles, are kept
  but never shown as links; a translation's information says how many words
  carry Strong's numbers and which of its own numbers it uses.
- A search for a Strong's number (`H430`) finds the words tagged with it, and
  a phrase is found across a tagged word.
- An export writes Strong's numbers in each format's own markup (USFM `\w`,
  USX `char`, OSIS `w`, Zefania `gr`), and Zefania's are read on import.
- Section headings and cross-references can be switched off, like Strong's
  numbers: from the reading panel's Show row, the palette or Settings.
- An eBible.org read-aloud, Browser Bible or website download is recognised,
  and the import names the `_usfx.zip` to take instead.
- Fixed: in the card studio's panels, every label sat far above its control.
- Fixed: the guide answered "how can you help me?" with a title and nothing
  under it; every answer now says something, and the question has its own.
- Fixed: a whole-word search in Burmese matched a letter inside a word.
- Guide data: searching and regular expressions, from plain words to
  lookarounds, with every example checked against the app's own matcher.

### 26.09.30.8 — 30 September 2026

- The Library is two pages. *On this device* shows only what is here, with
  a button to read each and a menu for the rest. *Get more* brings
  translations in, one source at a time: the Lai Siangtho catalog, getBible,
  eBible.org, a web address, or a file. Every list marks what is already
  here, including the same translation from another source.
- getBible's JSON is a format the importer reads.
- The desktop app downloads from eBible.org and other sites itself; the web
  version says when a site does not allow a web page to download from it.
- The guide can download more answers: an introduction to each of the 66
  books and help written topic by topic, kept offline once fetched. The data
  is schema.org FAQPage JSON-LD in the catalog repository's `guide/` folder.
- "What is John about" finds John, not 3 John.
- Every PNG icon is drawn from the SVG by `npm run icons`, and a test notices
  when they fall out of step. The ribbon in the icons is red, as in the SVG.
- The Library's list-or-grid setting is gone with the page it arranged.

### 26.09.30.7 — 30 September 2026

- Fixed: the boxes in the import dialog could not be typed in — each
  keystroke was replaced by what the file suggested.
- An OSIS file is named from its header title, and a language written right
  to left (Hebrew, Arabic, Persian, Urdu…) is set right to left on import.
- Your own translations are listed under the name you gave them.

### 26.09.30.6 — 30 September 2026

- **Compare a verse in every translation** on the device, in one sheet, from
  a verse number or `compare jn 3:16`; step through the passage with the
  arrows, copy one translation or all of them.
- **Links to a verse.** Copy link in the verse bar gives an address that
  opens on that verse (`#/43/3/16`, or a run `#/19/23/1-3`); from the desktop
  app it points at the web app, so it opens for anyone.
- **Memory verses.** Add a passage with Memorize; practise the ones due with
  words hidden — more as it sticks — and Again, Hard or Got it; spaced over
  1, 3, 7, 14, 30 and 90 days. Burmese is hidden by syllable.
- **Reading streak.** The Plan pane shows days in a row with reading,
  chapters this week, and how much of the Bible has been read.
- The guide knows about all four.

### 26.09.30.5 — 30 September 2026

- Detached tab windows and the note composer redrawn: one surface instead of
  a dark title band, a soft shadow instead of a drawn border, quieter window
  buttons, and notes written in the interface face rather than a typewriter
  one.

### 26.09.30.4 — 30 September 2026

- **Guide.** A new pane that answers "how do I…" in English, Norwegian or
  Burmese from what the app knows about itself, and offers the button that
  does it. A passage is answered with the passage; a question it cannot
  answer offers a Bible search. It starts switched off: `? …` or `ask …` in
  the palette opens it. It learns which answers you use, on this device only,
  and Settings → Study forgets that. No text is generated and nothing is sent
  anywhere.
- **Export options.** The Library's export dialog is drop-downs and chips:
  one file, gzipped, or a compressed zip; leave out Strong's numbers,
  headings or cross-references (offered only when the translation has them);
  add your own notes to Markdown or a spreadsheet; compact JSON and XML;
  English book names. It estimates the size, reports the real one, and
  remembers your choices per format. Every export keeps the copyright, and
  every zip carries ABOUT.txt.
- Licence: MIT throughout (package.json said UNLICENSED), copyright
  2016–2026 Khen Solomon Lethil.
- Fixed: importing USX or OSIS headed verse 1 with the book's own title, or
  the file's title; the export dialog's notes on what a format loses were
  English in every language; Zefania was said to keep cross-references.

### 26.09.30.3 — 30 September 2026

- Search is six times faster. Most of a search was spent folding text one
  character at a time; folds are now remembered per character, plain ASCII is
  only lowercased, and the offset map is built only for a verse that matches.
  Chapters are read a hundred at a time instead of one by one. One full Bible:
  1.35 s → 0.21 s in the worker; three: 3.7 s → 1.1 s.
- Release files renamed `LaiSiangtho.<os>.<arch>.<ext>` — for example
  `LaiSiangtho.win.x64.exe`, `LaiSiangtho.win.x64.portable.exe`,
  `LaiSiangtho.mac.arm64.dmg`, `LaiSiangtho.linux.x64.deb` — with no spaces and
  no version, giving each a permanent latest-download link.
- Fixed: in a wide window with both sidebars open, Settings squeezed its
  settings to 130 px beside its menu, the graph's and the card studio's
  buttons were clipped, and the tab strip pushed its new-tab button out of
  sight. Pages now follow the width of their pane.
- This changelog.

### 26.09.30.2 — 30 September 2026

- Interface in Norsk bokmål and Burmese as well as English, following the
  device's language or chosen in Settings → Language. Dates and counts are
  written in the interface language.
- Projects became a studio like Cards: one band with the project switcher and
  name, a stage that uses the full width, counts at the foot.
- The command palette puts an exact title first.

### 26.09.30.1 — 30 September 2026

- Phones: documents keep a finger's margin, Library rows give the name the
  width and put the button under it, row buttons are soft rather than solid,
  notices sit above the bottom bar, and controls get touch-sized room.
- Asking for a pane (Bookmarks, Plan, a note, find) opens its drawer on a
  phone, or its sidebar if closed.
- The first translation installed is the one in use at once.
- The desktop band always keeps an empty end to drag the window by.
- Text on the accent colour keeps its contrast in both themes.

### 26.09.29.19 — 29 September 2026

- Sidebars no longer come back empty after a restart once translations have
  been installed.

### 26.09.29.18 — 29 September 2026 (desktop)

- Window buttons as tall as the band.
- Linux software centres list the app, so it can be uninstalled from them.

### 26.09.29.17 — 29 September 2026 (desktop)

- The window can be dragged by the empty tab strip.
- The app's own icon on Linux instead of a generic one.

### 26.09.29.16 — 29 September 2026 (desktop)

- Frameless window on Linux, with the window buttons in the band's colours.

### 26.09.29.15 — 29 September 2026 (desktop)

- More download formats: Windows portable, macOS zip, Linux `.deb`, `.rpm`
  and `.tar.gz`.
- The AppImage runs without libfuse2.
- Releases are titled with their tag, and their notes are the commits since
  the previous release; running a published release's workflow again succeeds.

### 26.09.29.11 — 29 September 2026 (desktop)

- First desktop installers from the release workflow.

### 26.09.29.10 — 29 September 2026

- First release from the workflow: the web build published to
  laisiangtho.github.io.

### v0.2.0

- Phase 1: the single-file `index.html` reader, kept as this tag. Phase 2
  (everything above) is a rewrite on Vite and Electron sharing one interface.
