# Lai Siangtho

Bible reading and study, delivered as a web app (PWA) and a desktop app (Electron) from one codebase.

Version numbers are `yy.mm.dd.build` — `26.09.23.1` is the first build of 23 September 2026. `scripts/version.mjs` stamps `app/version.js` (the version the app shows), `package.json` (the date as semver, which npm and electron-builder require) and electron-builder's `buildVersion` (the build number).

Phase 2 of the project. The Phase 1 single-file `index.html` is preserved as git tag `v0.2.0`; its design system and shell are carried over here (see **Shell**).

## Commands

| Command | Result |
|---|---|
| `npm install` | Install the five dev dependencies (no runtime dependencies) |
| `npm run dev` | Web dev server |
| `npm run build` | Web build → `dist/web/` (static, deployable to any HTTPS host) |
| `npm run preview` | Serve `dist/web/` locally, service worker included |
| `npm run desktop` | Electron in dev mode (renderer hot reload) |
| `npm run desktop:build` | Compile main, preload and renderer → `out/` |
| `npm run desktop:package` | Installers for the current system → `release/` (`.dmg`/`.zip`; setup and portable `.exe`; AppImage, `.deb`, `.rpm`, `.tar.gz`) |
| `npm test` | Unit and boundary tests (`node:test`, no framework) — about a second |
| `npm run test:e2e` | The built web app driven in a browser, one file at a time: the ordered checks, the app across restarts, phone and title-bar layout (every page on a phone, in Burmese), the interface languages and projects studio, the Library, Strong's numbers and the rest of a translation's markup, and every card-studio panel on a desktop and on a phone |
| `npm run test:desktop` | The packaged Electron application, started and inspected |
| `npm run test:perf` | Timings at full size: three complete Bibles, the longest chapter, a whole-library search |
| `npm run test:crawl` | Every palette command run on a desktop (dark, light, Norwegian) and a phone (English, Burmese), the screen inspected after each for errors, overflow, leaked strings, clipped labels, overlapping controls and unnamed buttons (a few minutes a run) |
| `npm run test:all` | `npm test` then the browser suite |
| `npm run aliases -- <identify> [--file PATH] [--apply]` | Alias overlay maintenance (dry run by default) |
| `npm run icons -- [--apply \| --out DIR]` | Every PNG icon drawn again from `public/icons/icon.svg` (dry run by default; see `assets/icons/README.md`) |
| `node scripts/guide-check.mjs <folder>` | Check guide data (a `guide/` folder) the way the app reads it; exits 1 on any problem |
| `npm run version:stamp -- --apply` | Stamp today's date and the next build number |
| `node scripts/release-plan.mjs "release:all"` | What a release commit would release (see `docs/releasing.md`) |
| `node scripts/release-notes.mjs` | The notes the next release would get: commits since the last release tag |

The three test commands beyond `npm test`, and `npm run icons`, need a Chromium build to drive through `playwright-core` (found on the usual paths, or set `CHROMIUM_PATH`). Without it they say why and skip. A test that needs the desktop application also needs a display; on a machine without one, `xvfb-run -a node test/e2e/desktop.mjs`.

Node ≥ 20.19. Vite is pinned to 7.x because electron-vite 5 supports Vite 5–7; with Vite 8 the `electron` module gets bundled into the main process instead of being externalized.

## Layout

```
app/                      shared UI — never imports from targets/
  boot.js                 start({ root, createPlatform, features, config })
  config.js               defaults; unknown keys are rejected
  registry.js             feature / view / command registry, checkFeatures()
  core/                   pure data logic, no DOM (tested under node:test)
    settings.js           persisted settings + export/import envelope
    passage.js            a passage as Markdown, as a citation, as a printable sheet
    projects.js           study projects: entries, ordering, export, strict parser
    markdown.js           the small Markdown notes are written in
    plans.js              reading plans derived from the canon, verse of the day
    time.js               relative times from Intl
    search.js             query parsing, folding, match ranges, snippets
    annotations.js        notes and bookmarks, keyed on the passage
    source.js             chapter ⇄ Markdown, with scripture protected
    strongs.js            Strong's markup in verse text
    category.js           category.json parser
    catalog.js            book.json parser (remote + legacy shapes), update status
    translation.js        translation parser, split into chapter records
    align.js              merged-verse row alignment for parallel view
    reference.js          cross-reference parser and book resolver
    aliases/              app-owned alias overlays, one per translation
  services/               browser APIs
    store.js              IndexedDB (v4: translations, chapters, catalog, settings,
                          notes, marks, records)
    records.js            feature-owned documents: plan, board, ink, composer,
                          voices, projects, search, books, library, updates, welcome
    library.js            catalog checks, install / update / remove via worker
    settings.js           persisted settings (position coalesced, rest written at once)
    annotations.js        notes and bookmarks in memory, written through
    search.js             one worker, one live query
    transfer.js           JSON download / file picker (no native dialog needed)
    aliases.js            lazy overlay loader
  workers/library.worker.js   download → validate → split → write
  workers/search.worker.js    paged chapter scan, streamed results
  shell/                  the app itself: chrome, workspace, reading surface
    chrome.js             ribbon, sidebars, top band, status bar, toasts
    workspace.js          tabs, panes (leaves), row alignment, synced scrolling
    reading.js            one chapter: headings, merged verse labels, references
    tree.js               books pane with chapter chips
    modal.js              quick switcher, command palette, pickers
    versebar.js           verse actions contributed by features
    floats.js             detached windows
    dragdrop.js           tab / pane dragging, sidebar resizing
    readingpanel.js       text size, line height, line length
    markdown.js           note Markdown → DOM (wikilinks, tags)
    settingrows.js        the row vocabulary features build settings with
    confirm.js            the one question dialog, for what cannot be undone
    colorpicker.js        the app's own colour picker (drag to choose, commit on release)
    numberrow.js  menu.js
    theme.js  i18n.js  icons.js  dom.js
  features/               library/, settings/, search/, notes/, bookmarks/,
                          composer/, notes-manager/, tags/, backlinks/, outline/,
                          plans/, graph/, board/, ink/, speech/, verse-card/,
                          projects/, export-passage/, welcome/, help/ (+ formats.js),
                          export-chapter/ (desktop only)
  styles/                 shell.css (Phase 1 design system), views.css (additions)
targets/
  csp.js                  Content-Security-Policy for production builds
  web/                    index.html, main.js, platform.js, theme.css,
                          manifest.webmanifest, sw.js, shell-plugin.js
  desktop/                index.html, main.js, platform.js, theme.css,
                          preload.js, electron/ (main process)
public/                   category.json, book.json, icons — served at '/'
assets/                   packaging icons, drawn from public/icons/icon.svg
scripts/icons.mjs         redraws every PNG icon from the SVG
scripts/guide-check.mjs   checks guide data the way the app reads it
scripts/aliases.mjs       alias overlay tool (Node standard library only)
test/                     unit tests, architecture boundary tests, fixtures
docs/architecture.md      decisions, data findings, trade-offs
```

## Shell

The Phase 1 interface is the shell, and `app/styles/shell.css` is Phase 1's stylesheet unchanged — the same token ramp, dark and light, and the same class names. The shell builds that markup from the registry:

| Phase 1 | Now |
|---|---|
| Ribbon buttons | commands with `ribbon: true` |
| Sidebar panes | `registry.pane({ side: 'left' \| 'right' })` — the books tree is the shell's own |
| Workspace tabs | chapters, plus one tab per `registry.doc()` (Library, Settings) |
| Command palette (Ctrl+P), quick switcher (Ctrl+O) | `shell/modal.js`, fed by the registry and `category.json` |
| Verse bar | `shell/versebar.js`; buttons come from `registry.verseAction()` |
| Parallel panes, synced scroll | `workspace.js`, aligned by verse spans from `core/align.js` |
| Themes and accents | `shell/theme.js`; the preference lives in settings, so an export carries it |
| Typography | `shell/readingpanel.js` — the scripture's size, line height and line length, and the interface's own size, which the whole ramp and every control height are derived from |

A sidebar pane carries no title row: the tab above it already names it, and the name is the tab's accessible name and the panel's `aria-label` rather than a line out of every column.

The shell is chrome, not a document: it selects nothing and keeps the arrow throughout. A half-selected tree row that expanded on release used to leave a highlight behind that looked like a fault. Everything a reader might actually want to copy — the scripture, their own notes, a copyright line, the fields they type in — opts back in.

Parallel alignment works on blocks, not pixels: each verse, its section headings and its references form one `.vblock`, and blocks that cover the same verses are levelled per row. A translation that merges 17–18 stays level with one that does not, and synchronised scrolling follows the verse rather than the scroll offset.

## Search, notes and bookmarks

**Search** scans the chapters of the translations that are offline; no index is built at install time. The scan runs in a worker, reading chapters from IndexedDB a hundred at a time, so memory holds a page rather than a translation and results stream in as they are found; a new query abandons the running one.

What comes back is the shape of the answer, not the first forty lines of it: **how many verses matched, in how many chapters, in how many books**, and then those books as a tree to open. Counting carries on past the display limit, so a common word reports all nine thousand of its verses and shows the first two thousand; opening a book whose verses were past that limit searches that one book again, which costs a fraction of the first scan.

Three switches sit at the end of the field they act on, shown when it is pointed at or typed in, and left on show whenever one of them is on:

| | |
|---|---|
| `ab\|` | Whole words only — `man` no longer matches `manner`. Off, a term matches anywhere in a word |
| `.*` | The query is a regular expression, as written. A pattern that does not compile says why. With this on, whole words is not offered: a pattern sets its own boundaries |
| `Aa` | Capitals matter |

Under them, the scope: which translations — none chosen means the one being read — and where. Both are chosen the same way, because a checkbox for each of sixty-odd translations is a column of scrolling nothing: what is chosen shows as chips, and a field beside them finds the rest. Where can also be the whole Bible, the open book, a testament, or a section of the canon (Law, Poetry, Gospels…), in one press.

Every choice is remembered. Plain and whole-word matching fold case and Latin accents (`etait` finds `était`) while leaving Myanmar, Arabic and Hebrew marks alone, and match offsets map back to the original string so highlighting lands on the right characters. A regular expression is matched against the text as written, since folding it would change what the pattern means.

A search limited to a few books reads only those books' key ranges instead of reading the whole translation and discarding most of it. On full-size Bibles the whole of one translation answers in about 0.6 s and three in about 1.3 s; one book is a fraction of that. Most of a search used to be folding text one character at a time (1.6 s for one translation); folds are now remembered per character, plain ASCII is only lowercased, and a verse's offset map is built only when it matches.

### Going somewhere quickly

The command palette (`Mod+P`), the quick switcher (`Mod+O`) and the books filter all read a reference written the way a reader would say it: `ps 23`, `Psa 3:5`, `psa 3:2-4`, `1 jn 2:1`, and the same in the translation's own name and numerals (`ကမ္ဘာဦးကျမ်း ၃:၅`). A book is matched exactly first — a name, a short name or a published abbreviation — then by prefix; a token that fits several books offers each of them rather than guessing. In the palette a passage is offered above the commands, since somebody who typed a passage meant a passage. `app/core/lookup.js` does the reading and touches nothing else.

### Telling it to do something

The palette takes an instruction as well as a name: a word, then what it acts on.

| Typed | Does |
|---|---|
| `note ps 23:1-6` | opens the composer on that passage |
| `mark jn 3:16` | bookmarks that verse and goes there |
| `find mercy endures` | runs the search |
| `parallel kjv` | opens that translation beside the one being read |
| `export gen 1:1-2` | offers the shapes it can leave in |
| `card ps 23:1-3` | draws that passage as an image |
| — | a ribbon button lights while what it does is on: the Library while the Library is in front, ink while ink is on |
| `project ps 23` | files the passage in the open project |
| `go 1 jn 2:1-4`, `copy jn 3:16` | go there; copy the reference |

A verb may be shortened while it is still the only one starting that way. A word on its own is never a verb — "parallel" typed alone is still the command called Open parallel pane — the space after it is what says something follows. A passage verb with nothing after it acts on the passage on screen. Every verb is also a button or a command, and the Shortcuts document lists them from the registry.

### The books pane

Testaments, books and a grid of chapter chips. The switch in the filter field decides whether the tree **follows the reading**: with it on, the book on screen opens itself; with it off, every branch is the reader's to open and close. Either way a branch shut by hand stays shut — the tree records what was opened and what was deliberately closed, so no rule overrules the reader.

**Notes and bookmarks key on the passage** — book, chapter, verse — never on a translation. A note written while reading Tedim is on that verse in NIV too. Notes attach to a chapter, to a verse, or to **a run of verses**: press a verse number, then Shift-press another, and the passage between them is what the note or the bookmark covers — which is what a study note or a sermon is usually about. Every verse of a run is tinted, and pressing any of them clears the whole run. Both live in their own IndexedDB stores, appear in the sidebar panes, and travel in the settings export.

The verse bar opens from a verse number and holds whatever the features registered — note, bookmark, copy. A build without the bookmarks feature simply shows fewer buttons.

## Study

Everything Phase 1 offered is here, each as its own feature, so a build can leave any of it out.

| | |
|---|---|
| **Composer** (`Ctrl/Cmd+J`) | a floating window on the passage in view — write, split, preview; the title line is the note's first heading. It edits the same notes the Notes pane does. |
| **All notes** | every note in one table: filter, sort by updated, created, passage or length, open in the composer, export one or all as Markdown, delete. |
| **Tags** | `#theme/shepherd` in a note becomes a way back to every note carrying it; the cloud sizes each tag by use. |
| **Links** | what points at the chapter in view — `[[Genesis 1]]` wikilinks resolved through the same parser the cross-references use, and plain-text mentions alongside them. |
| **Outline** | the chapter's section headings and verse titles, to jump inside a long chapter. |
| **Plan** | the verse of the day, a way back to where reading stopped, and a reading plan — the whole Bible in a year, the New Testament in 90 days, the Gospels in 40, Psalms in 30. The schedule is derived from the canon, and progress is just the set of chapters read, so reading ahead or catching up needs no bookkeeping. |
| **Link graph** | chapters as nodes, drawn from what you have touched: chapters carrying notes or bookmarks, the wikilinks between them, and the cross references printed in those chapters. Drag a node to move it, the background to pan, click to open. |
| **Study board** | verses and thoughts as cards on a canvas. Double-click the board for a card, a card to edit it, Delete to remove one. |
| **Ink** | freehand marking over the reading surface, kept per chapter and scaled to whatever width the window has next time. |
| **Read aloud** | the device's own voices, from the chapter or from a verse. The ribbon button shows what it is doing: a pause bar while it speaks, a ring round the edge for how far through the chapter it has got, and the verse it has reached in its tooltip. Settings → Reading lists every voice the device has, built when you open it and gone when you close it, grouped by language with a play button on each so you can hear one before choosing it. Where no voice exists for the translation's language, the command says so rather than doing nothing — and the voice list ends with *a voice in another language*, which is how a language with no voice of its own gets read at all, and how you read the King James in Norwegian if you want to. That choice is remembered against the translation rather than the language, so it never leaks into every English text, and the app says which voice is speaking so an accent is not mistaken for a fault. |
| **Cards** | any passage drawn as a PNG — one verse or a run of them, numbered — in the script's own fonts, direction and word breaks. The studio is an editor: press the text or the reference to pick it up, drag it and it follows exactly, take a corner and the opposite one stays put, guides appear where it lines up with a margin or a centre (Alt ignores them), arrow keys nudge, Ctrl/⌘ Z undoes. The card itself is sized from its own right edge, foot or corner, with Shift to keep its shape, and you say whether that scales the design or leaves the frames where they are. Give the text less room than it needs and the card says so, offering both answers: fit the text, or grow the frame. The rest is behind six tool buttons — templates, which verses, shape, colour, type, reference — each opening a panel of the card workspace that stays open while you work in it. You start with four finished templates; the foot warns when text and background are too close in lightness to read on someone else's screen, and a story-shaped card shows where the app it is posted to will cover it. A template holds size (post, square, story, slide, page, or your own), margin — which the frames really do keep to, so widening it moves them in — corners, background (theme, solid or a gradient at any angle), ink and accent colours, border, typeface, alignment, a text size fitted to its frame or set by hand, where the reference goes and whether the translation is named; it exports and imports as a file. |
| **Following a reference** | press it and it opens where you are, as before. Rest on it — on a machine with a real pointer — and it opens where it stands, so you can read a cross-reference without losing your place. Ctrl/⌘-press or middle-press opens it in a tab of its own. |
| **Source view** | any chapter as the file another program would read — Markdown, this app's JSON, USFM, USX, OSIS, Zefania or a spreadsheet — beside the reading, taking the whole pane. The format, a copy button and a save button are one button in the crumb bar, which also shows which format is on. Markdown is the one you can edit: your notes under "## Notes" save when you leave the box. |
| **Export and convert** | any translation on this device, written out as any of those formats: the whole thing, a testament, one of the canon's own groupings, or books you name. The dialog is two drop-downs, a row of chips and a line of summary. Format and how it is saved — one file, one file gzipped, or a compressed zip — share a line; the chips leave out Strong's numbers, headings or cross-references (each offered only when the translation has it) or add your own notes (Markdown and spreadsheets); JSON and XML can be written compact; Markdown and spreadsheets can use English book names. The summary says how many books, chapters and files, roughly how big, and what the format cannot carry, before you press rather than after. The copyright goes into every format with a place for it, and every zip carries `ABOUT.txt` beside the files. The last choices are remembered per format. |
| **Strong's numbers** | carried in from tagged editions (USFM, USFX, USX, OSIS, Zefania) and shown on the reading surface when switched on — nowhere else: a card, a search result, the verse of the day, a copied or spoken verse is always the plain text. Press one and the lexicon says the word, how it is said, what part of speech it is and what it means; type one, like `H430`, into search to find the words tagged with it. Numbers an edition uses past the end of Strong's lexicon — eBible.org's tagged Judson Bible marks particles `H9999` — are kept and counted but never offered as links, and the translation's information says what it carries. The lexicon is fetched the first time you ask and kept for reading offline — and only the testament you asked about. |
| **Your own translations** | the library takes a file you have: this app's JSON, USFM, Zefania, OSIS, USFX, or a spreadsheet of book, chapter, verse and text. It reads the file, tells you what it thinks it is and fills in the name, short name and language, and you correct whatever is wrong and press Import. It also takes a whole published archive — an eBible.org zip is the scripture, the translation's own book names, its metadata and its copyright, and all of it comes in together. It is then checked against the canon exactly as a published translation is, and gets the same report of where it differs. Nothing is uploaded anywhere. The library lists them under **Yours**. |
| **Library** | the Cards page's shape: one band of tools, no title. Two pages. *On this device* is the home: only what is here, each with its short name, where it came from, whether an update is waiting, a button to read it and a menu for the rest (export, about, report, remove). *Get more* is where translations come from, one source at a time — the Lai Siangtho catalog, getBible, eBible.org, a web address, or a file. Every list marks what is already here, and a translation that is here under another source's name is marked *Same as … on this device*, so the King James Version is not downloaded three times. eBible.org and most web addresses refuse to be read by a web page; the desktop app downloads them itself, and the web version says so instead of failing quietly. An eBible.org download that is not the data — the read-aloud, Browser Bible or website edition — is recognised and the matching `_usfx.zip` named instead. |
| **Projects** | the work the reading is for: a sermon, a lesson, a series, a chapter. A project is an ordered list of passages, Markdown notes and tasks; passages are kept as references, so the verses are quoted from whichever translation is open and a project sent to somebody else reads correctly in theirs. It exports as its own file to come back whole, and as Markdown for anyone who does not use this app. There is a pane for it beside the reading. |
| **Compare** | one verse in every translation on this device, in one sheet: each in its own script and direction, the one being read first, a merged verse saying which verses it covers, a missing one saying so. The arrows (and ← →) step through the passage; each row copies or opens that translation. From a verse number, or `compare jn 3:16` in the palette. |
| **Links to a verse** | *Copy link* in the verse bar gives an address that opens on that verse — `…/#/43/3/16`, or `#/19/23/1-3` for a run. From the desktop app it points at the web build, so it opens for anyone. The verse stays in the address while its chapter is open, so a reload lands on it again. |
| **Memory verses** | learning passages by heart. *Memorize* in the verse bar (or `memorize ps 23:1-3`) adds one; the Memory verses page lists them with how far each has come and when it is next due. Practice shows the verse with words hidden — a third, then half, then only first letters, then all — press a gap to see its word, Space to show the verse, then Again, Hard or Got it (1, 2, 3). Got it brings it back in 1, 3, 7, 14, 30 and 90 days; Again in ten minutes. Burmese is hidden by syllable. The words come from the translation the verse was added in. |
| **Reading streak** | the Plan pane counts the days in a row with reading, the chapters of the last seven days, and how much of the Bible has been read at least once. A chapter counts after half a minute in front of the reader with the window on screen, or when it is ticked in a plan. |
| **Guide** | a pane that answers “how do I…” in your own words — English, Norwegian or Burmese — from what the app knows about itself: topics written for it, and every command, palette verb, document and setting in the build, each with the button that does it. A passage is answered with the passage; a question it cannot answer says so and offers to search the Bible for those words. It starts switched off: `? …` or `ask …` in the palette opens it, as does its command. Nothing generates text. More answers — an introduction to every book of the Bible, and help written topic by topic — can be downloaded from the `guide/` folder of the catalog repository when the reader asks for them; that is the only time it goes online. It learns which answers you use (and which you mark *Not this*) and ranks them accordingly; Settings → Study forgets that. Its code loads the first time it opens. |
| **Export a passage** | any passage, with your notes in it: Markdown to paste into a document, a citation to drop into a paragraph, the plain text, a Markdown file, or a sheet set for paper. |

Notes are written in a small Markdown: headings, emphasis, code, quotes, lists, links, `[[Genesis 1]]` wikilinks and `#tags`. Notes are rendered as DOM nodes, never as HTML strings.

## Workspace

| Doing this | Gets you |
|---|---|
| Drag a tab sideways | reorder |
| Drag a tab down out of the strip, or double-click it | a detached window — drag its bar to move, its corner to resize, "Put back" to dock |
| Drag a pane's head onto another | swap the parallel panes; the leftmost is the primary translation |
| Drag a detached window's bar over the tab strip | dock it back where it was |
| The `+` at the end of the strip | a new tab on the passage in view, with the switcher open to send it elsewhere |
| Drag a sidebar pane's tab | reorder it, move it to another row, drop it on the other sidebar, or drop it into a row's body to split that sidebar into rows |
| Drag a row divider | share the height between two sidebar rows |
| Drag a sidebar's inner edge | resize it; the width is remembered |
| Click a breadcrumb | its siblings — the testament's books, or the book's chapters, marking the ones this translation carries |
| Drag a ribbon button up or down the rail | move it; carry it to the bin at the foot — which is the add button, while a drag is running — to take it out, with an undo in the toast |
| The `+` under the ribbon, or right-click a button | add any command in the build, or put the defaults back |
| The `⋯` at the end of a strip | whatever did not fit — tabs, or the panes of a sidebar too narrow for all of them. It carries the count, and the one you are on is never the one hidden |
| `Ctrl/Cmd+B` | hide or show the left sidebar; the ribbon and status bar have their own commands |
| `Ctrl/Cmd+E` | source mode |
| `Ctrl/Cmd+W` | close the tab |
| The status bar's size button | the reading panel: text size, line height, line length, verse layout |

Open tabs and their order, the active one, sidebar rows and their heights, panel sizes and every toggle are remembered and reopen with the app.

Two rules keep dragging honest, both learned from defects: every drag listens on the window rather than on the element it started from, and nothing re-renders while a drag is running — the model changes once, on release. Re-rendering per pointer move destroyed the element under the pointer, which is why dragging used to stop working and leave a caret behind.

Nothing rebuilds a page the reader is looking at, either. A document tab that is already mounted is left standing when the state changes, and a part of a page that does repaint keeps the scroll position and the focus across the rebuild — pressing a button in the Library used to throw the list back to the top, which made an application feel like a web page reloading.

While a document tab is active — Library, Settings, Help, a board — the controls that act on a chapter are shown but not pressable, rather than failing when pressed. Detached windows remember the size and position they were last left at.

The status bar carries the app's mark, the translation, the passage, and the word and verse counts of the chapter on screen; on the right, typography, mode, Strong's, synchronised scrolling, and how much storage the app is using (its tooltip names the quota and whether the browser has agreed to keep the data).

**Help, Shortcuts, About, Data and formats** and **Welcome** are documents, reachable from the `?` at the foot of the ribbon. The shortcut table is generated from the command list, so it cannot describe a key this build does not bind, and it lists the palette verbs the same way; About reports what is installed and what is stored.

**Data and formats** documents every file the app reads and writes, with a real example of each: the catalog, a translation file, a language pack, the diagnostics report, what is kept in IndexedDB, the settings envelope and a project file — and where this build is actually pointed. Anyone who wants to correct a verse, add a translation or read their own notes with another program can do it from that page; an app that keeps its formats to itself is asking to be trusted rather than checked.

**Welcome** is shown once, on the very first run, and stays in Help afterwards. It claims the first screen from the Library (`shell.claimFirstRun()`, decided while features are being set up so it does not depend on which first paint finishes first), because a list of sixty translations is not an answer to "what is this".

**Source mode** shows the chapter as Markdown. Scripture is read-only — it belongs to the translation file, which the app never writes to. What can be edited is your own material under `## Notes`: a chapter note as plain text, verse notes as `- **17** …`. On save, everything above that heading is compared with what was rendered, and a change there is refused with a message rather than silently dropped.

**Strong's numbers** are read from the verse text where a translation carries them (`{H7225}`, `{H1254:HVqp3ms}` with its morphology, `<S>430</S>`, `[H430]`), attached to the word before the code. A word with several numbers (the KJV's "created" is H853 and H1254) shows them all and the popover offers each.

**Word study and the originals.** Hebrew and Greek are only what the reader imports — the Westminster Leningrad Codex as OpenScriptures OSIS, an eBible.org Hebrew or Greek text as USFX, or a browserBible zip — and a translation in Hebrew, Aramaic or Greek that carries Strong's numbers becomes the original its testament is read against (`services/lemmas.js`). Pressing a tagged word offers *Study this word*: the original word in that verse with its morphology spelled out (STEPBible's TEHMC/TEGMC tables, `core/morph-data.js`, loaded with the study), the lexicon entry (fetched, or STEPBible's TBESH/TBESG imported as a file), and every word the translation uses for the number with its verses. That last list comes from a per-translation index (`core/lemmas.js`) built the first time a word in it is studied and kept, stamped with the install; browserBible's own `index/` and `indexlemma/` folders are not read, because an index built from the stored text cannot disagree with it. The **interlinear line** (Reading → Show) puts the original under each verse, a word over its gloss. Verses are matched by number, so where a translation numbers differently from the original the line is the original's verse of that number.

## Language and script

Names resolve in one order — **the translation file → the language pack → the canon**. Packs are `lang/iso-{code}.json` from the catalog repository, keyed by ISO 639-3, naming a language's testaments, books, sections and digits; they are fetched once per language and kept, so names never depend on being online. The pack key comes from the translation file, which carries 639-3 in `info.language.name`; the catalog's two-letter codes name no pack.

Every control whose text comes from the translation carries the canon's English name as its `title` and `aria-label` — tabs, breadcrumbs, tree rows, chapter chips, the chapter picker, the status bar. A reader who cannot read the script is never guessing what a click will open.

Every name the reader sees comes from the translation where the translation has one: book names, and testament names too (`ဓမ္မဟောင်းကျမ်း`, `Thuciam Lui`), in the tabs, the breadcrumbs, the books tree and the chapter header.

The reading surface carries the translation's `lang` and `dir`. Translation files name their language by ISO 639-3 (`mya`, `ctd`), so the parser also reads the two-letter code and prefers it — `:lang(my)` does not match `lang="mya"`, and that one mismatch is why Burmese was being set with Latin line spacing.

Burmese needs that room. The script stacks marks above the consonant (ိ ီ ံ), below it (ု ူ) and beside it (ျ ြ ွ ှ), and marks a killed consonant with an asat (်), so a line carries close to twice the ink of a Latin line and collides with its neighbours at 1.5–1.66. It is set at 1.26 × the reader's own line height — a multiple, not a fixed number, so the reading panel still works on it — with a Myanmar face ahead of the reading face. Arabic gets 1.12 × the size and 1.16 × the height. The `lang` attribute also matters for line breaking: Burmese puts no spaces between words, and only the engine's own breaker knows where a line may end.

Numbers that name a chapter — in a tab, a breadcrumb, the books tree, the status bar, the chapter picker — are written in the translation's own digits (`၃`, `၃/၅၀`). Counts stay in the interface's digits: 39 books is a quantity, not a chapter.

Interface text is set at a unitless `line-height: 1.5` so a label's box is a multiple of its font size rather than of the font's own metrics; without that, a Burmese label made its button taller than the Latin one beside it.

Interface strings live in `app/shell/i18n.js` and nowhere else — features included. Labels are named for what they do, not what they point at: "Close", not "Close this tab"; "Bookmark", not "Bookmark this verse". A label that carries a passage into the string ("Note on {ref}") reads badly once translated and is avoided.

## Narrow windows and touch

Under 900 px a sidebar comes in as a drawer over the text with a scrim behind it; under 760 px the status bar gives way to a floating navigation pill, the band carries the app's mark, and the tab strip shows only the active tab — press it for the list of the others. A window grown back to a column layout puts the drawer away.

A page lays itself out by the width of the pane it is in, not the window's: a wide window with both sidebars open leaves the page about 400 px, and there Settings puts its menu above the settings, the graph's bar wraps, the card studio drops its size readout, and the one tab the strip keeps shrinks to an ellipsis rather than pushing the new-tab button out of sight.

## When something goes wrong

Nothing is allowed to fail silently, and nothing that can be recovered is left without a way back.

- A feature that cannot register is named in a message; the rest of the application starts. A pane or document that throws on mount shows the reason inside its own body.
- A full quota says what to do about it. An install is a single transaction, so the copy already held survives a failed one.
- A chapter missing from a stored copy is told apart from a book the translation never carried: when the translation's own index lists the book, the copy is incomplete and **Download again** repairs it.
- If the application cannot start at all, the screen offers **Try again** and a two-press **Erase stored data**, saying what erasing costs.
- The same **Download again** is in the translation information popover, for a file corrected upstream without the catalog's version changing.

## Staying current

The web build downloads a new version and **waits**: the reader is offered *Reload*, and assets from two builds never mix. The desktop build asks the releases API from its main process — so the renderer's `connect-src` stays limited to the catalog host — and offers a link; it downloads nothing by itself. Both check once a day, silently unless there is something to say, and by hand from the command palette.

## Rules

1. **`app/` never knows which target runs it.** No imports from `targets/`, no `electron`, no `window.lai`, no `platform.id === '…'`. `test/boundaries.test.js` fails the suite on any of these.
2. **`app/core/` is pure.** No DOM, storage, `fetch` or Vite-only APIs. Enforced by the same test.
3. **Structure errors fail; content differences are reported.** A wrong type or unknown key in a data file raises a `DataError` naming the file and JSON path. Versification differences and unresolved references are returned as diagnostics and shown in the UI.
4. **Remote text is never parsed as HTML.** `shell/dom.js` assigns text only.
5. **Data files are read-only.** `category.json`, `book.json` and translation files are shared with other applications; the app adapts to them (alias overlay, empty-string normalisation) instead of changing them.

## Customising a target

Everything that differs between web and desktop is decided in `targets/<name>/main.js`:

| To change | Edit |
|---|---|
| Which features ship | the `features` array in `targets/<name>/main.js` (unlisted features are not bundled) |
| Colours, spacing, fonts | `targets/<name>/theme.css`. Accent tokens are redefined per theme in the ramp, so an override must match that specificity: `html[data-theme="dark"], html[data-theme="light"] { --accent: … }` |
| Native services | `targets/<name>/platform.js` (`capabilities`) |
| URLs, intervals, start view | the `config` object passed to `start()` |

A feature that needs a native service declares it:

```js
export default { id: 'export-chapter', requires: ['saveFile'], setup(ctx) { … } };
```

`boot` refuses to start when a target lists a feature whose required capability its platform lacks, and names both in the error.

## Adding a feature

1. Create `app/features/<id>/index.js` exporting `{ id, requires?, setup(ctx) }`.
2. In `setup`, register views (`ctx.registry.view`) and commands (`ctx.registry.command`). Navigation and the command palette pick them up automatically.
3. List the feature in each target's `main.js` that should include it.

`ctx` provides `platform`, `config`, `category`, `store`, `library`, `settings`, `annotations`, `search`, `records`, `state`, `shell`, `registry` and `aliases(identify)`. A feature registers documents (`ctx.registry.doc`), sidebar panes (`ctx.registry.pane`, with an `order`), commands (`ctx.registry.command`), verse actions (`ctx.registry.verseAction`), **settings rows** (`ctx.registry.setting`, with a `section` and an `order`) and **palette verbs** (`ctx.registry.verb`); the shell renders all six.

A settings row is built from the vocabulary the page hands it — `ui.toggle`, `ui.choice`, `ui.select`, `ui.number`, `ui.action`, `ui.readout` — so a row contributed by Search looks like a row written by the page itself. Sections are named in `core/settings.js` and checked when the row is registered, so a mistyped section is a startup error rather than a row nobody ever sees.

## Alias overlays

Cross-references use localised abbreviations that are often absent from both the translation's book info and `category.json` (Tedim: `Siam`, `Sawl`, `2Kum`, …). `app/core/aliases/{identify}.json` maps them to book ids without touching either file.

```
npm run aliases -- tedim1932                 # dry run: report and suggestions
npm run aliases -- tedim1932 --apply         # write, keeping existing entries
```

A mapping is written only when the token matches exactly one book's name *and* the cited chapter:verse locations fit that book. Anything else is written as `null` (known, unmapped) and listed for review. Review the diff before committing.

Tedim status: 69.5% of reference parts resolve without the overlay, 92.7% with it (`Mang` → Revelation confirmed). `Thkna` and `Thna` stay `null` because they fit both Deuteronomy and Judges; they render as plain text with the reason in a tooltip, which is also how every unresolved reference behaves.

## Settings

Persisted per device in IndexedDB: last translation, book and chapter, the parallel selection, theme, accent, verse layout, synchronised scrolling, row alignment, and the sizes of the scripture and of the interface.

The Settings page is where they are seen rather than remembered: a column of sections with a list of them beside it, one setting a line, each with a sentence saying what it does.

| Section | Holds |
|---|---|
| Appearance | theme, accent (a palette, a colour of your own, a reset that greys out when there is nothing to reset), ribbon, status bar, movement, and which buttons the ribbon carries |
| Reading | verse layout, scripture typeface, synchronised scrolling, levelled verses, section headings, cross-references, Strong's numbers, reopening last session, and a fold with every installed translation's text direction |
| Typography | the four sizes, and a reset |
| Study | what the Books pane, Search, the composer and the card studio each own — contributed by those features rather than duplicated here |
| Keyboard | the shortcut document |
| Storage | what is installed, what the browser has room for, update checking, and — last, always — resetting every setting and erasing everything on this device |
| Your material | notes, bookmarks, projects, and moving them to another device |

Anything that cannot be undone asks first, in the app's own dialog, with the cancel focused. Everything on the page is also in the command palette, which is how it is found by name rather than by looking. The reading position is coalesced (250 ms); every other change is written at once, since a write started from `pagehide` is not reliably finished by the browser. Writes are coalesced (250 ms), so chapter stepping does not cost a transaction each time.

Export (Settings view, or the command palette) writes `lai-siangtho-settings-YYYY-MM-DD.json`:

```json
{ "app": "lai-siangtho", "schema": 1, "exportedAt": "…",
  "settings": { "translation": "tedim1932", "book": 43, "chapter": 7, "parallel": ["niv2011"],
                "theme": "dark", "accent": null, "layout": "paragraph",
                "syncScroll": true, "alignRows": true },
  "library": { "catalog": { "version": 260, "updated": "…" },
               "translations": [{ "identify": "tedim1932", "version": 3 }] } }
```

Notes and bookmarks travel with it, under `data`. Translation text is not (several MB each). Import restores the reading state, merges the notes and bookmarks, and lists the translations that are not installed here, with one button to download them. A file from another app, or a newer `schema`, is refused with a message naming the problem.

On desktop the export uses the browser download path, so the app's own save dialog appears; a target can route it through the native dialog instead by giving the feature a `saveFile` capability.

## Licence

The code is MIT (`LICENSE`). The scripture is not part of it: each translation belongs to its publisher, keeps its own copyright, and carries it into every export, where the metadata header is always written and cannot be switched off.
