# Lai Siangtho — Phase 2 Architecture

Status: the Phase 1 feature set and its shell behaviour are ported, and Phase 2 now goes past them (26.09.26.4) — see README.md for commands and layout. Phase 1 single-file `index.html` is preserved as git tag `v0.2.0`; Phase 2 intentionally drops the single-file / no-build-tools constraint.

Targets: web (PWA over HTTPS) and desktop (Electron), sharing one UI codebase.

Beyond Phase 1, this build adds: a settings page features contribute their own rows to; a ribbon the reader arranges; palette verbs (`note ps 23:1-6`, `find mercy`); taking a passage out as Markdown, a citation or a printed sheet; verse cards drawn from templates the reader owns; study projects, which hold the passages a sermon or a lesson is made from; a public "Data and formats" document; and a first-run screen. Sections 3c-ii, 3c-iii, 3d-ii, 3d-iii, 3d-iv and 9e cover them.

---

## 1. Data contracts

Three data sources exist. Their **structure is frozen** (other applications consume them); content may change.

| File | Role | Source of truth |
|---|---|---|
| `category.json` | Canonical skeleton: testaments, sections, 66 books, chapter counts (`clue.c`), verse counts (`clue.v`), grouping (`guide`, `@guide: "testament.section.book"`), English names/abbr | Bundled in `public/` |

The canon is what every file is *measured* against, never a limit on what is
*shown*: the reading surface and the parallel alignment are built from the
verses a file actually holds, so a chapter with one more verse than the canon
renders whole, in one column or four. Four chapters where published editions
carry a verse this canon did not — 1 Chronicles 19, 2 Chronicles 13, 3 John and
Revelation 12 — were corrected, and a test pins them: they are the difference
between a true report and a chapter reported short for agreeing with its own
tradition.
| `book.json` | Catalog of available translations | **Remote** `https://raw.githubusercontent.com/laisiangtho/bible/refs/heads/master/book.json`; bundled copy is a first-run seed only |
| `json/{identify}.json` | One translation (e.g. `tedim1932.json`) | Remote `https://raw.githubusercontent.com/laisiangtho/bible/refs/heads/master/json/{identify}.json`; never bundled |

### 1.1 Catalog (`book.json`)

- Remote shape: `{ name, updated, version, book: [...], collection }`. Only `book[]` is app content; `updated` (ISO timestamp) and top-level `version` (integer, e.g. `260`) are used for change detection. `name` and `collection` are ignored by the app.
- Bundled `public/book.json` is currently a bare array (12 entries) — a different shape from remote (64 entries). A remote catalog, once fetched, **fully replaces** the local one.
- The catalog parser accepts exactly two known shapes (remote object, legacy bare array) and throws a descriptive error on anything else. Preferred end state: bundled copy regenerated as a trimmed snapshot of the remote object so only one shape exists.
- Entry `version` types are inconsistent (remote: 62 integers, 2 strings — `jwmynwt`, `bbe1949`; bundled: all strings). Versions are normalised with `Number()`; a non-numeric result is a validation error, not a silent pass.
- Entry fields: `identify, name, shortname, year, language{text, textdirection, name}, version, description, publisher, contributors, copyright`.

### 1.2 Translation file

Top level: `info, note, digit, language, testament, story, book`.

- `info.identify` must equal the requested identify; `info.version` (integer) is compared with the catalog entry `version` for update detection. For `tedim1932` both are `3`.
- `book[id].info` — localized `name, shortname, abbr[], desc`. Localization is incomplete in places (e.g. Tedim Isaiah: `name: "Isaiah"`, `abbr: []`).
- `book[id].chapter[c].verse[v]` — `{ text, title?, ref?, merge? }`.
- `story[book][chapter][verse]` — pericope heading `{ text, ref }`, `ref` in OSIS-like form (`Gen.1.1,Gen.2.25`).
- Size: full Tedim is 5.2 MB raw, 1.4 MB gzip on the wire. Raw host sends `access-control-allow-origin: *`, `cache-control: max-age=300`, and an `etag`.

### 1.3 Variations across published translations

Measured on tedim1932, niv2011, judson1835, ddb1931, bbe1949, jwmynwt, mizo1917; all parse under the validator.

- `jwmynwt` publishes `title`, `ref`, `merge` on every verse, mostly as `""`; empty strings are normalised to absent.
- `book[].topic` is `{}` or `[]`; unused.
- `bbe1949` has `info.version: "1"` (string).
- `ddb1931` has 1,039 merges and 153 chapters that differ from `category.json` verse counts; `bbe1949` 96.
- `info.shortname` can be `""` (jwmynwt); localised book names are sometimes English (mizo1917, niv2011).
- Parse time in Node: 50–170 ms per full translation.

### 1.4 Verse fields (measured on full `tedim1932.json`)

| Field | Count | Meaning |
|---|---|---|
| `text` | 30,715 | Verse text |
| `ref` | 3,235 | Cross-references, localized form: `Pian 22:2; La 2:7; Mat 3:17; 12:18`, `Mat 7:28-29` |
| `title` | 2,329 | Section sub-heading shown before the verse |
| `merge` | 272 | String: last verse number included in this verse. Covered verse keys are absent. |

- `merge` spans: +1 (235), +2 (19), +3 (8), +4 (2), +6 (4), +9, +11, +14, +26 (one each). Alignment must handle wide spans.
- Versification differs from `category.json` in 4 Tedim chapters: 1 Chr 19 (20 vs 19), John 7 (52 vs 53, 7:53 absent), 3 John 1 (14 vs 15), Rev 12 (17 vs 18). `category.json` drives navigation, not rendered rows.

---

## 1b. Language packs

`lang/iso-{code}.json` in the catalog repository names one language's
testaments, books (84, deuterocanon included), sections and digits, and carries
a `locale` block of interface strings. Packs are keyed by **ISO 639-3**.

The two-vs-three character problem solves itself *for packs*: `book.json` uses
639-1 (`da`, `my`), but the translation files carry 639-3 in
`info.language.name` (`dan`, `mya`, `ctd`), so the pack key comes from the
translation and no mapping is needed. A two-letter code names no pack and is not
requested.

It does not solve itself for the browser. `lang="mya"` matches no `:lang(my)`
rule, tells the line breaker nothing, and is not the tag a speech engine
answers to — a Burmese voice calls itself `my-MM`. `core/langcode.js` is the
one place that maps between them, and it turns out the browser already knows
how: CLDR carries the 639-3 → 639-1 equivalences as locale aliases, and
`Intl.Locale` applies them while canonicalising (`mya → my`, `nob → nb`,
`cmn → zh`, `tgl → fil`). A code that stays three letters after that has no
two-letter form, which is a fact about the language rather than a lookup that
failed — and is very nearly the same set of languages no device ships a voice
for. `EXTRA` in that module is for what CLDR misses and is kept deliberately
short: a hand-maintained copy of a standard is a copy that goes wrong quietly.

`parseTranslation` applies it once, so `info.language.code` is the tag
everything downstream uses, and `info.language.iso` is kept rather than
discarded for anything that needs to know which of the two it is holding.

Every name the reader sees resolves in one order:

```
the translation file  →  the language pack  →  category.json (the canon, English)
```

The translation wins because it is the edition in front of the reader; the pack
fills in what that file omits; the canon is the last resort — and, being always
English, is also what every localised control offers as its accessible name.

Packs are cached in the records store (`lang:{code}`) and read from there on
later runs, so names never depend on being online; a cached pack older than 30
days is used immediately and re-fetched in the background. A missing pack is
normal, not a failure.

`locale` is not wired yet: those keys are the upstream app's, not this one's.
It is the obvious path to a translated interface, and the reason to keep the
pack service rather than inline the names.

## 2. Cross-reference resolution

- Translation files are **not** edited (a content change forces every consuming application to treat the file as modified).
- Resolution table per translation = translation `book[].info` (`name`, `shortname`, `abbr[]`) ∪ `category.json` `book[].info` (`name`, `shortname`, `abbr[]`).
- Measured on Tedim: 4,935 book-prefixed references, **1,488 (≈30%) unresolved** with that union. Top misses: `Thkna` 339, `Siam` 218, `Mang` 212, `Sawl` 183, `2Khang` 105, `2Kum` 97, `1Kum` 95, `1Kor` 63, `1Khang` 56, `Efe` 41.
- Gap closer: an **app-owned alias overlay**, one file per translation (`app/core/aliases/{identify}.json`, `{ "Siam": 3, "Mang": null, ... }`), applied before the two sources above. Neither `category.json` nor translation files change. `null` declares a known token without a confirmed mapping.
- Overlay maintenance: `scripts/aliases.mjs` (Node standard library; reuses `app/core` so the tool and the app share one parser). Dry-run by default; `--apply` writes. A mapping is written only when the token prefixes exactly one book name among books with a matching ordinal **and** ≥95% of cited chapter:verse locators fit that book; everything else is written as `null`.
- Tedim result: 69.5% resolved without overlay → 92.7% with it (`Mang` → 66 confirmed). `Thkna` and `Thna` remain `null`: the citations fit both Deuteronomy and Judges, so they stay plain text rather than risk a wrong link.
- Within a layer, primary names (name, shortname) outrank abbreviation variants: `category.json` lists "I Sa" for 1 Samuel, which normalises to "isa", the shortname of Isaiah.
- Grammar handled (measured on Tedim, Mizo, Judson): `;` separators; the Myanmar section mark `၊` as separator after a number; continuation parts inherit the previous book (`Mat 4:23; 9:35`); `:` and `.` chapter-verse separators (`24:14`, `24.14`); verse, chapter and chapter:verse ranges; comma lists; cross-book ranges (`1Sam 16:1-1Kum 2:11`); single-chapter books citing verses only (`File 10-12`); native digits via the translation's `digit` table; zero-width spaces inside tokens; trailing note words (`Thulu`).
- Unresolved parts render as plain text with the reason in a tooltip — never dropped, never fatal to rendering.

---

## 3. Storage

| Option | Decision |
|---|---|
| localStorage | Rejected — ~5 MB cap, synchronous, strings only |
| **IndexedDB** | **Chosen** — quota is a large share of free disk; available in workers; atomic transactions |
| OPFS | Deferred — same quota/eviction as IndexedDB; only worthwhile for SQLite-WASM full-text search later |
| File System Access API | Rejected as primary — Chromium only, permission prompts |
| Electron `fs` (`userData`) | Deferred — only if another app needs user-visible files |

Layout:

- Store `translations`: key `identify` → `{ info, note, digit, language, testament, story, books: {id → info}, version, installedAt, bytes, stats, diagnostics }`.
  `stats` is what the file holds (books, chapters, verses, merges, titles, refs); `diagnostics` is `{ total, items }` — where the file departs from the canon, capped at 400 entries so a translation missing most of the canon cannot bloat the record. Both are shown in the translation information popover and summarised on the library row, and the whole report can be saved as JSON.
- Store `settings`: key `'current'` → the persisted settings (see 3b).
- Store `chapters`: key `[identify, book, chapter]` → verses as published, normalised only where the data is inconsistent (empty optional strings removed, `merge` stored as a number).
- Install / update: a worker fetches, validates, splits and writes everything in **one readwrite transaction**; the previous copy remains until the new one commits.
- `navigator.storage.persist()` requested on first install. Safari evicts script-writable storage after 7 days of no interaction for non-installed sites; installed PWAs are exempt.
- UI shows per-translation size and "Remove offline copy".
- Electron uses the same IndexedDB code; the renderer is served from a custom `app://` protocol (standard + secure privileges), never `file://`.

---

## 3b. Settings and transfer

- Persisted settings (IndexedDB store `settings`, schema v2): `translation`, `book`, `chapter`, `parallel`, the chrome flags, and the typography — including `uiSize`, the interface's own text size, from which the whole interface ramp and the heights of the controls in it are derived. Validated and clamped against `category.json` on every read and write; unknown keys are an error.
- Writes are coalesced (250 ms) because chapter stepping fires rapidly.
- `boot` seeds the session state from settings and writes back only the persisted subset, so features may keep other state without it being stored.
- Export envelope: `{ app, schema, exportedAt, settings, library: { catalog, translations[] } }`. Translation text is excluded by design; import restores state and offers to re-download the listed translations.
- Import refuses a foreign `app` or an unsupported `schema` with a message naming both.
- Transfer uses plain browser APIs (`Blob` download, `<input type=file>`), shared by both targets; native OS dialogs remain a platform capability.

## 3c. Search, notes and bookmarks

- **Search**: no install-time index. A worker walks an IndexedDB cursor over `chapters` and streams matches in batches; a newer query cancels the older one. Measured in Chromium on the full data: one translation ≈ 1.0 s (5.2 MB, 1,189 chapters, 31k verses), two ≈ 2.0 s. An inverted index would cut query time at the cost of build time and storage; revisit if the wait becomes a problem.
- **Matching** (`core/search.js`): words ANDed, `"phrases"` literal, case and Latin-accent folding only (Myanmar, Arabic and Hebrew marks are meaning-bearing and kept). Fold positions map back to the original string so highlight ranges are correct.
- **Notes and bookmarks** (`core/annotations.js`) key on book/chapter/verse, never on a translation: an annotation belongs to the verse, so it shows in every translation. Notes: chapter-level or verse-level, several per verse, random ids. Bookmarks: one per verse, id derived from the passage. Both validate against `category.json` (unknown book, chapter out of range, unknown colour are errors).
- Stored in IndexedDB v3 (`notes`, `marks`), held in memory for the reading surface to consult per verse, and carried in the export under `data`. Import merges by id — nothing is dropped.
- The verse bar is the shell's; its buttons come from `registry.verseAction()`, so a build without a feature simply has fewer.
- Settings writes: only the reading position is coalesced; other changes write immediately, because a write started from `pagehide` is not reliably completed.

### 3b-i. Sidebar rows

A sidebar is a column of rows; each row has its own tab strip and shows one of
its panes. Settings hold `sidebarLeft` / `sidebarRight` as
`[{ views: [paneId], active, size }]` (`size` is a flex-grow share, frozen to
measured pixels when a divider drag starts so untouched rows keep their height).
Up to `MAX_ROWS` (4) rows a side.

Pane views are built and mounted **once** and parked in a holder when not on
show, so rearranging a sidebar never remounts a pane — a search with results in
it survives being dragged into another row, or to the other sidebar. Moving a
pane across sidebars hands the mounted node to the other side's holder, and the
disposer with it.

### 3b-i-a. A pane the reader has switched off

Panes are services rather than controls — linking, searching, noting, outlining
— so switching one off takes a tool out of the sidebar and changes nothing
else. Every registered pane has a command of its own, generated in
`registerPaneCommands` after every feature has registered, so no feature writes
one and a build with fewer features has fewer commands. The palette is the
whole interface for it.

**Absence is the state; there is no second flag.** Hiding removes the id from
its row, which is the operation dragging already performs, so rows, sizes,
splitting and cross-sidebar drag need to know nothing about any of this.
Showing puts the pane back at the `side` and `order` its own registration
declares — which is what makes that metadata a home rather than a first guess.

One field makes that possible. Absence from the arrangement used to mean one
thing, *new*, which is why `arrange()` placed anything it did not recognise;
it now means one of two, and `settings.sidebarKnown` — the panes this reader
has been offered — says which. A pane that is known and absent stays absent; a
pane this build has just added is unknown, so it still arrives on its own. The
list is written once the arrangement is settled, so a feature that failed to
register is not recorded as offered and appears when it works again.

Two seams needed work, and both would have failed quietly:

- **`selectPane` revives.** Five features reach their own pane by name
  (search, notes, bookmarks, tags, plans). Against a pane that is switched off,
  `has()` answers for neither side and the call would have done nothing at all
  — a palette entry that looks broken. It now switches the pane back on, and
  builds and mounts it *now* rather than on the next repaint, because
  `search.open` follows it with a `focus()` on a box that does not otherwise
  exist yet.
- **The disposer is kept.** `registry.pane` has always documented that `mount`
  may return a function that undoes it, and eight of the nine panes return one;
  the shell discarded it, so a pane could be built and never taken down.
  `mountOne` keeps it on the entry and `dispose` runs it when the pane goes, so
  a pane that is not on screen is not watching the reading position. A disposer
  that throws is reported and let go of — the pane is going either way, and a
  half-removed pane is worse than an untidy one.

An empty sidebar is still an empty sidebar however it was emptied: `empty` is
`views.size === 0`, and hiding deletes the view, so the side toggle disables
itself and says why exactly as it did when the last pane was dragged out.

Panes are still all mounted at startup. Deferring a mount until a pane is first
shown is the larger saving and a behaviour change for every reader, including
those who hide nothing, so it is deliberately not in this batch.

Every pixel of a sidebar resolves to a drop: a strip means "join this row at
this index", a row body half means "make a new row above/below". Dropping the
last pane out of a row removes the row; heights are reset only when the row
count changes.

A settings **migration** handles the rename from 26.09.23.3's flat
`panesLeft` / `panesRight`: stored settings pass through `migrateSettings`,
which maps them to one row per side and drops keys this build no longer has,
reporting what it dropped. Imported files stay strict — they carry a schema
number and are someone else's data.

### 3b-ii. Narrow and touch layout

The stylesheet carried Phase 1's responsive rules from the start; this wires
them. At ≤900 px a sidebar arrives as a drawer over the text, with a scrim and
`body.drawer-l` / `drawer-r` / `has-drawer`; one at a time, and a window grown
back to a column layout closes whichever was open. At ≤760 px the status bar
gives way to a floating navigation pill (drawers, previous, next, palette), the
band carries the app pill, and the tab strip shows only the active tab — which
is why that tab carries a chevron: pressing it opens the tab switcher, the
modal listing every open tab plus "new" and "close".

### 3c-i. Feature records

Settings has a fixed schema, validated key by key; reading-plan progress, the study board and ink strokes do not fit it and are far larger. They live in IndexedDB v4 store `records` (key: the feature's name → its document), behind `services/records.js`: loaded once at startup, written through on change, carried in the export under `data.records`. Each feature owns exactly one key and is its only writer, so no two features can fight over a record.

| Key | Owner | Holds |
|---|---|---|
| `plan` | plans | `{ id, start, read: { "book.chapter": when } }` |
| `board` | board | `{ cards: [{ x, y, w, h, title, text, colour }] }` |
| `ink` | ink | `{ "book.chapter": [{ colour, size, width, points }] }` |
| `composer` | composer | window geometry, mode, split ratio |
| `voices` | speech | chosen voice per language |
| `projects` | projects | `{ projects: [ … ], open: id }` — study projects and which one is open |
| `welcome` | welcome | `{ seen, at }` — the first run happened |
| `books` | shell tree | `{ follow, counts }` |
| `search` | search | mode, matchCase, the translations and books it is pointed at |
| `library` | library | which listing the Library opens in |
| `updates` | updates | `{ auto, checkedAt, latest }` |
| `direction` | workspace | per-translation text-direction corrections |
| `lang:{code}` | langpacks | a cached language pack |

## 3c-ii. What features contribute to the shell

A feature registers four kinds of thing through `registry`, and two more were added in this batch. All six are pure data plus a callback, so the boundary tests still hold and a target can leave any feature out.

| Call | Contributes | Notes |
|---|---|---|
| `doc` | a workspace tab | Library, Settings, Projects, Data and formats, Welcome |
| `pane` | a sidebar pane | `{ side, order }` — its home, and where a pane switched back on returns to. `mount` may return a disposer, which is now kept |
| `command` | a palette entry, optionally a hotkey and a ribbon button | |
| `verseAction` | a button in the verse bar | receives `{ book, chapter, verse, to }` |
| `setting` | **a row on the settings page** | `{ section, order, build(ui) }`; sections are named in `core/settings.js` and checked at registration, so a typo is a boot error rather than a row nobody sees |
| `verb` | **a word the palette accepts as an instruction** | `{ word, takes: 'passage'\|'text', run(argument) }` |

A command also says where its button goes: `ribbon: true` for the rail down the side — a place to go — and `bar: true` for the band over the text, beside the tabs — something done to what is being read. Ink moved from the first to the second, because a button that is dead on every document tab does not belong in a column of destinations; in the band it greys out with the rest, like Open parallel pane.

**Settings rows.** Settings is the one place a reader looks for what they can change, but most of what they can change belongs to a feature. The page owns the layout and the feature owns the setting: `registry.setting` hands the feature the row vocabulary (`shell/settingrows.js`: `toggle`, `choice`, `select`, `number`, `action`, `readout`, `row`), so a row written by Search looks like a row written by the page. The page's own destructive pair (reset settings, erase everything) is registered the same way with `order: 900`, which keeps it at the bottom however many rows the features add above it.

A page that reads settings on every paint cannot repaint while a control on it is being held — the control would be replaced under the pointer. Settings therefore holds still while a picker is open (`hold(true)`), and the colour picker reports a drag in two parts: `onChange` on every pointer move (paint only — a CSS variable and the swatch), `onCommit` once on release (`state.set`). An e2e test counts repaints during a drag and requires zero.

**Palette verbs.** `note ps 23:1-6`, `mark jn 3:16`, `find mercy`, `parallel kjv`, `export gen 1:1-2`, `project ps 23`, `go 1 jn 2`, `copy jn 3:16`. A verb may be abbreviated while it is still unambiguous. A *word on its own is never a verb* — "parallel" is the command called Open parallel pane, and a reader who typed it and pressed Enter meant that; the space after the word is what turns it into an instruction. A passage verb with a space and nothing after it acts on the passage on screen. Every verb is also an ordinary command or button, so nothing is reachable only by typing; the Shortcuts document lists them all from the registry.

### 3c-iii. The ribbon is the reader's

What a feature asks for (`ribbon: true`) is only the starting arrangement. `settings.ribbonItems` — a list of command ids, or null for "this build's own" — is what the rail draws once the reader has touched it. A button is dragged up or down the rail to move it and off the rail to remove it (with an undo in the toast that restores the exact order), right-clicked for the rest, and any command in the build can be added by name. The four fixed buttons — go to, the palette, help, theme — stay, because they are how the reader reaches everything else, including the way back from a ribbon they have emptied.

Every shell command carries its own icon — the quick switcher and the palette used to share a fallback glyph — and a button can say what is happening: `state()` for something that is on or off, `opens` for something that brings up a document. The Library button is lit while the Library is the tab in front of the reader, the ink button while ink is on.

Nothing on the rail is locked. The quick switcher, the palette, help and the theme are the *default* list rather than fixed furniture — a reader who never uses the switcher can take it off — and the way to put anything back is under the rail, not in it: a footer carrying the `+` that adds any command by name and, when the rail runs out of height, the `⋯` that lists what did not fit along with "add" and "reset". That footer is chrome, so the ribbon can never be emptied into a state it cannot be recovered from.

Removing is a bin, not a button on the thing being removed. The first attempt put a small × on each button, revealed by hovering it — which is a trap: the ribbon is a column of 30 px buttons pressed dozens of times a day, and the one control that destroys part of it sat a few pixels from the one that runs it. There is now nothing to hit by accident. The add button at the foot *becomes* a bin while a drag is running — the only moment removal can be meant — a button is removed only by being carried to it and let go, a drag that ends anywhere else is a move or nothing at all, and the toast that follows offers an undo that restores the exact order.

Two rules keep the rest honest. A stored id this build no longer has is dropped as the rail is drawn, so a list outlives the features it was written against. And a press that never travels is still a press: dragging never costs the reader a click, which is the same bargain the tab strip makes.

## 3d. Workspace, source mode and chrome

- **Versioning**: `yy.mm.dd.build`. `scripts/version.mjs` writes `app/version.js` (display), `package.json` (`yy.m.d`, the semver npm and electron-builder need) and electron-builder's `buildVersion`. The version appears in Settings, in the About command and in the export envelope.
- **Tabs** each carry their own passage; the active tab mirrors into the shared state that the tree, status bar and panes read. Tabs, the active index, sidebar widths, chrome toggles, typography and mode are all in settings, so a session reopens as it was left.
- **Detached windows** are in-app frames (`shell/floats.js`) holding the same leaf — or the same doc, mounted a second time — that the workspace builds. Not a second OS window: the web build has none, and one renderer keeps docked and floating from drifting apart.
- **Dragging** (`shell/dragdrop.js`) is pointer-event based throughout: tab reorder, tab out of the strip (> 52 px below it) to detach with a preview of the window it would become, a detached window dragged back over the strip to dock, sidebar pane tabs reordered / moved to another row / moved to the other sidebar / dropped into a body half to split it, pane heads to swap panes, sidebar edges and row dividers to resize. Two rules hold every drag together, and both were learned from defects:
  - `pointermove` / `pointerup` are listened for on the **window**, not on the dragged element, and come off in one place. Listening on the element loses the drag the moment the pointer outruns it, and leaves the class, the ghost and the drop marks on screen.
  - **Nothing is re-rendered mid-drag.** The model changes once, on release. Re-rendering per move destroyed the element under the pointer: the drag stopped, the caret stayed behind, and the order was never committed — exactly the "dragging stops working and leaves a mark" report.
- **Tab reorder** follows Phase 1's feel: the dragged tab tracks the pointer, the others slide by exactly one tab width to open the gap, and the splice happens on release.
- **A document already on screen is left alone.** `renderPanes` runs on every state change — a theme cycled, a chapter stepped, a translation installed — and used to tear down the open document tab and mount it again each time. That is why the Library scrolled back to the top whenever a button on it was pressed: not the list repainting, but the whole page being rebuilt from nothing, which is also what it looked like. The workspace now remembers which document is mounted and leaves it standing; documents repaint themselves through their own listeners.
- **A repaint keeps the reader's place.** `dom.js` has `keepPlace(el, render)`: the scroll position of the enclosing scroller and the focus (by `data-place`) are taken before the rebuild and put back in the same frame, before anything is painted. The Library, Settings, Projects and the card studio all repaint through it.
- **A document that is a workspace takes the room it is given.** `.doc` caps its width at a comfortable measure and centres it, which is right for reading and wrong for a canvas: the link graph, the study board and the card studio were being drawn in a column with the workspace empty on either side. `.doc-full` clears the cap and the margin, and the leaf it sits in stops scrolling — what is inside it does.
- **One scrolling box per document.** The workspace hands a document a `.leaf-scroll`; a document that built another inside it ended up with two, and `overscroll-behavior: contain` on the inner one can stop a wheel reaching the outer. Help, Shortcuts, Data and formats and the notes manager each built their own; they no longer do, and an e2e check counts the scrollers in every document.
- **A strip that cannot show everything hides what does not fit**, and the button at its end says how many and lists them. `shell/overflow.js` holds the rules and both strips use it — the sidebar's pane tabs and the workspace's own tabs, the second stood on end for the ribbon. Scrolling was the obvious answer and the wrong one: a scrollbar in a 28 px band is unusable, a swipe hides that there is anything to swipe for, and either way the item at the edge is drawn cut in half, which reads as a fault. Three rules make it legible: the button is an item of the strip like any other, never an overlay; the active item is never the one that disappears (an earlier one goes instead, so the active item ends up beside the button — which is also how it stays visible in a narrow window); and the menu lists the whole row, setting back the ones already on show, so it does not change shape with the width of the window. Widths are measured from the items themselves, not from `scrollWidth`, which counts the absolutely positioned pseudo-elements that draw the sheet's curve outside the box. In the narrow layout this button replaced the chevron the active tab used to carry: one mechanism instead of two.
- **Asking before something cannot be undone** is `shell/confirm.js`: one dialog, the cancel focused, Escape and the backdrop both meaning no.
- **The reading panel** is built once and only its values are repainted; geometry is set when it opens, so clicking inside it cannot make it move under the pointer. It carries the popover arrow (`--arrow-x`, `.is-above`) pointing at whatever opened it, and its reset is a quiet link in the foot rather than a button the size of the controls.
- **Source mode** (`core/source.js`) renders the chapter as Markdown and accepts edits only under `## Notes`; the scripture section is compared on save and a change is refused. Verse notes are `- **17** text`, the chapter note is loose text.
- **Strong's** (`core/strongs.js`) reads `{H7225}`, `<S>430</S>` and `[H430]`, attaching each code to the preceding word. No published translation carries the markup today, so the toggle reports that rather than appearing to do nothing. The regex is built per call — a shared `/g` regex carries `lastIndex` between `test()` and `matchAll()`, which silently skipped the first match until a test caught it.
- **Typography**: text size, line height and line length are CSS variables set from settings by the reading panel — on the **root element**, not the body. The ramp derives `--fs-text` from `--reading-size` at `:root`, and a custom property is resolved where it is declared, so setting them on the body moved every number in the panel while the text never changed.
- **Interface line height**: `body { line-height: 1.5 }`, unitless. With `line-height: normal` the line box comes from the font's own ascent and descent, and the Myanmar faces ask for close to twice the Latin metrics, so a button with a Burmese label grew taller than the same button in Latin. Unitless (not `1.5em` or `150%`) because a length inherits as a fixed number of pixels, which would give nested text at another size the wrong leading. Labels clipped to one line take `padding-block: 3px; margin-block: -3px` — ink room that costs no layout height.
- **Digits**: a number that names a chapter is written in the primary translation's own digits (`localizeNumber`) wherever it appears — tabs, breadcrumbs, the books tree, the status bar, the breadcrumb picker. A count (39 books, 30 verses) is a quantity and stays in the interface's digits.
- **Script typography**: the reading surface carries `lang` and `dir` from the translation. Files name their language by ISO 639-3 (`mya`, `ctd`), so the parser also reads `info.language.iso["639-1"]` and prefers it — `:lang(my)` never matches `lang="mya"`, which is why Burmese was rendering with Latin line spacing. Burmese stacks marks above the consonant, below it and beside it, and marks a killed consonant with an asat, so a line carries roughly twice the ink of a Latin one: it gets `calc(var(--lh-text) * 1.26)` — a multiple of the reader's own setting rather than a fixed number, so the reading panel still moves it — plus a Myanmar face stack. Arabic gets 1.12× the size and 1.16× the height. The language also reaches the element because the browser's own line breaker needs it: Burmese writes without spaces between words.
- **A script's numerals need room too.** The chapter grid stacks two numbers in a 30-pixel chip — the chapter at 11px, its verse count at 8px — which is generous for Latin digits and unreadable for Burmese ones, built as they are from closed loops and stacked strokes. The chips now carry the translation's `lang` like the reading surface does, and the same stylesheet that gives Burmese text its line height gives Burmese chips more height, larger numbers and a wider grid cell; a second rule covers the scripts that are taller than Latin without needing the extra width.
- **English behind every localised control**: any control whose visible text comes from the translation — tabs, breadcrumbs, the books tree, chapter chips, the chapter picker, the status bar's passage — carries the canon's English name as `title` and `aria-label`. A reader who cannot read the script can still tell what a click will open, and a screen reader announces something it can pronounce.
- **The crumb bar** reads translation ▸ testament ▸ book ▸ chapter, and ends with one button: what this translation is (description, language, publisher, copyright, the version held against the version listed, install date and size), and from there "Download again" — because a translation file can be corrected upstream without the catalog's version changing, and an installed copy would otherwise never hear about it. A copyright line pinned above the text is read once and then read past forever, while costing a strip of every chapter; behind a button it is one press from the text it describes and absent the rest of the time.
- **Names in the reader's language**: book names, and now testament names, come from the translation (`meta.testament[id].info.name`) wherever they are shown — tabs, breadcrumbs, the books tree, the chapter header — with the canon as fallback. Chrome that carries such a name is tagged with the script's language so it gets the same line room.
- **Chapter-only controls**: a command may declare `needsChapter`. While a document tab is active, `body[data-tab="doc"]` is set and those buttons are shown but not pressable — the nav arrows, the parallel-pane button, layout, source mode, Strong's, synchronised scrolling, ink, read aloud, verse card and chapter export — rather than failing when pressed.
- **An empty sidebar** keeps its place in the document: while a pane is being dragged it shows a rail to drop onto, and a pane dropped there opens that sidebar. Without it, the last pane moved out of a sidebar could never be moved back.
- **The Library** filters on name, abbreviation, language, publisher or year, and arranges itself by language, as one flat list, or as the offline set only; the choice is remembered.
- **Detached windows** remember the size and position they were last left at (records key `floats`), offset so a second window does not hide the first and clamped into the window as it is now.
- **Resize handles** draw no grip in any state: the grip's percentage offset resolved differently while a drag was running, which put a mark at the top of the window. The moving edge and the cursor are the feedback.
- **The status bar** reports what is being read — translation, passage, word count and verse count for the chapter on screen — and on the right the state the reader can click, ending with storage use (`navigator.storage.estimate()`), whose tooltip names the quota and whether the origin is persisted. Counts are measured from the chapter records actually in view, so they describe what is in front of the reader.
- **Help, Shortcuts and About** are documents (`features/help/`). The shortcut table is generated from the command registry, so it cannot describe a key this build does not bind; About reports the installed translations, their bytes, note and bookmark counts, storage use and eviction state.
- **The breadcrumb picker** (`shell/navpop.js`) opens the siblings of whichever crumb is pressed: the testament's books, or the book's chapters, marking the chapters the translation actually carries. Choosing a book moves to its chapters without moving the arrow.
- **Scroll fades** (`shell/fade.js`) set `--fade-top` / `--fade-bottom` on scrollable areas, so an edge with more beyond it fades rather than drawing a line. Nothing is dimmed when the content fits.
- **Icons**: `public/icons/icon.svg` is the source; PNGs at 1024/512/192/32 are derived for the manifest, the favicon and desktop packaging.

## 3d-i. Passages

- A note or a bookmark may cover a run of verses: `verse` is where it starts and `to` where it ends (null for one verse). `parsePassage` checks the order only — how many verses a chapter holds is the translation's business, so a run past the end of one edition is still a reference. `chapterIndex` expands a run so every verse it covers is tinted; a note's dot stays on the verse it starts at.
- `toggleMark` over a run clears whatever bookmarks it overlaps rather than adding another on top, so pressing the same control twice returns the reader to where they started.
- **Following a reference** has one set of manners, in `shell/reflink.js`, used by every surface that renders one: press to follow in place, `Ctrl`/`⌘`-press or middle-press for a new tab, and resting on it reads it where it stands. The default is untouched — a reference opens in place because that is what works on a phone and on a machine with little memory to spare — and everything added is asked for explicitly. `shell.openChapter`/`openVerse` now forward `{ newTab }` to the workspace, which had supported it all along behind a signature that dropped it, so until this batch nothing in the app could open a second tab.
- **The peek** (`shell/peek.js`) reads the verses from the store the reader is already in, keeps the last six chapters, and puts its two ways out — open here, open in a new tab — as icons on the reference line itself. A popover over a paragraph should cover as little of it as it can, and a foot with two labelled buttons in it was a fifth of the box spent on chrome. It is armed only where `matchMedia('(hover: hover) and (pointer: fine)')` is true: a touch device reports a hover as the moment before a tap, so a preview bound to it appears under the finger that is about to press the thing it covers.
- `app/core/lookup.js` reads a reference out of typed text — `ps 23`, `psa 3:2-4`, the translation's own names and numerals — for the palette, the quick switcher and the books filter. Exact match first (canon and translation names, short names, published abbreviations), then prefix; a prefix that fits several books returns them all.

---

## 3d-ii. Taking a passage out

`core/passage.js` (pure, tested) writes a gathered passage three ways: Markdown (a blockquote per verse, the reader's notes under it, marked verses in `==…==`), a citation (one paragraph with the reference after it), and a printable sheet (a whole HTML document with its own print styles, opened in a window of its own). The `export-passage` feature gathers what those need — text from the store, notes from annotations, names from the translation being read — and offers the five shapes through the modal. Saving prefers the platform's `saveFile` capability and falls back to a browser download, so the web build is not short of a feature the desktop has.

## 3d-iii. Study projects

A note answers "what do I think about this verse"; a project answers "what am I making". `core/projects.js` (pure, tested) holds the model — an ordered list of entries, each a passage reference, a piece of Markdown, or a task — with add/edit/move/remove, a progress count, a Markdown export and a strict file parser.

Three decisions worth keeping:

- **A passage is a reference, never copied text.** The text comes from whichever translation is being read, so a project opens correctly for whoever receives it and stays correct when the translation is updated.
- **A project is a file.** `{ app, kind: 'project', schema, project }` exports and re-imports whole; the same project also exports as Markdown for people who do not use this app. An import never replaces a project already held — a same-id import lands as a second copy, because the file may be an older version of what its owner has been working on all morning.
- **The shelf drops what it cannot read** rather than refusing to open: a project from a future build is skipped, and the export file remains the copy of record.

The feature adds the Projects document (shelf beside the open project), a right-hand pane for use while reading, a verse action, a palette verb and a Settings row.

## 3d-iv. Cards

A card is a picture of a passage made for somewhere this app is not — a message, a slide, a printed sheet.

`core/card.js` (pure, tested) holds the template and every piece of arithmetic the editor needs: `layoutCard` places the two frames and fits the words inside them, `resizeFrame` moves or resizes a frame by a handle, `snapLines` and `snapTo` say what a frame should line up with and which line it took, `frameToTemplate` turns pixels back into the fractions a template keeps, `wrapLines` carries each piece's kind so verse numbers can be drawn in their own colour, and `contrastRatio` answers whether a card will be readable anywhere but here.

**The frames are the design.** The first version described the text by an alignment and an anchor down the card — a fine way to *store* a layout and a hopeless way to edit one: dragging could only snap the text between three places, and no handle could mean "make this box this big". A template now carries `box {x, y, w, h}` and `ref {x, y, w}`, and `align` says what it says — where the lines sit inside their own frame.

**A frame is measured against the content box, not the card.** `contentBox(t)` is the card inside its margin, and 0 to 1 spans that; a frame may run outside it, because text bleeding off an edge is a design and not a mistake. This is what makes the margin a measurement rather than a decoration: widen it and the frames move in with it. Frames older than that rule were written against the whole card, so `parseTemplate` converts them once and stamps `space: 'inner'`; conversion is idempotent, which matters because every edit re-parses the template it is editing. A template written against the anchor model before either is read through both, and opens where its author left it.

**The studio is an editor.** Press a frame to pick it up; drag and it follows exactly; take a corner and the opposite one stays where it is; edges keep the edge across from them; guides appear where it lines up with a margin, a centre or the other frame, and Alt ignores them; arrow keys nudge by a pixel of the card, ten with shift; Escape puts down whatever is held; `Mod+Z` and `Mod+Shift+Z` walk the history. None of that is special to cards — it is what an editor is, and until all of it was there the studio was a settings page with a picture beside it.

**The card has its own edges too.** A picture whose size can only be typed is not a picture you can size, so the right edge, the foot and the corner are draggable, with Shift keeping the proportions. The scale at which the card is shown is held still for the length of that drag — re-fitting it to the stage on every step would make dragging the corner outwards do visibly nothing. What happens to the frames is the template's answer, not a guess: `grow` is `scale` (they keep their share, so a post survives becoming a story) or `keep` (they keep their measurements and the card grows around them).

**A frame dragged smaller than the words in it is a question, and it is asked where it happened.** The frame is marked, and the foot offers both answers — fit the text to the frame, or grow the frame to the text — because either is what somebody meant. The same choice lives in the type panel as the text size: fitted to the frame, or set by hand.

Everything else is behind six icon buttons — templates, which verses, shape, colour, type, reference — each opening a panel of this document with no heading of its own: the pressed button says what it is, and Escape, the button again or a press anywhere else closes it. A panel takes all the room under its button rather than a share of the workspace. The toolbar uses the same overflow button as every other strip. Where a symbol is universal it is drawn rather than spelled (alignment, text sizing), with the words as the title and the accessible name.

Escape and the outside press are heard at the **document**, for the length of the mount, and not at the studio's own element. Pressing a control in a panel rebuilds that panel, which takes the pressed button out of the document and hands focus back to `<body>` — and an element never hears a key pressed at its own ancestor. An element listener therefore worked until the reader touched a panel, and then Escape and undo quietly stopped.

Four rules the panels follow, all learned from defects.

- A panel is built when it opens and is **not** rebuilt while it is being used: rebuilding on the first step of a drag replaces the slider under the pointer and the drag dies with it, which is how a slider comes to behave like a button — so `numberRow` separates `onChange` (every step) from `onCommit` (the release), and only a change that alters which rows belong asks for a rebuild. A rebuild keeps the panel's scroll position.
- Rebuilding a panel is **not** the same as toggling it. `show(which, anchor, { toggle })` toggles only for the button that opens it; the rebuild path passes no toggle, because a panel that put itself away every time a preset was pressed is a panel nothing can be tried twice in.
- A control **is one control**. The slider and the figure beside it are two halves of one number, so `numberRow` holds the value itself and writes both halves on every change, skipping only the half being typed in — a slider whose figure does not move is two controls disagreeing in public. For the same reason a segmented choice marks itself on press rather than waiting to be rebuilt: otherwise it looks broken every time the change it makes does not happen to alter the rest of the panel.
- A panel never scrolls sideways: a control too wide for the panel is a panel that should have been two.

Three things that are help rather than knobs: a new reader starts with four finished templates instead of one grey default; the foot says when the text and its ground are too close in lightness to read, measured against both stops of a gradient — the failure that actually happens, because it looks fine on the screen it was made on; and a card taller than 16:9 shows where a story app's own header and buttons will cover it, drawn on the stage and never on the canvas.

## 3d-v. Reading aloud

`speech` drives the device's own voices, and matches on the language rather
than the exact tag (`core/langcode.js`), which is what makes a file saying
`mya` and a voice saying `my-MM` the same language. Until this batch it read
`info.language.name` — the 639-3 code — so every translation whose file carried
a 639-1 code was matched against a tag no engine knows, and Read Aloud reported
"no voice" on devices that had one.

**A voice may be chosen across languages**, and the rules for that are in
`core/voices.js` (pure, tested without a speech engine): `byLang` is a fact
about the device and serves every translation in that language; `byTranslation`
is the deliberate oddity and wins, because it was chosen in the presence of the
alternative. Choosing the language's own voice again clears the override rather
than leaving one behind that agrees with it.

**The ribbon button is a process, not a switch.** `state()` may answer with a
boolean, as most commands do, or with `{ on, icon, title, progress }` — which
is what a command whose state is a *process* has to say. Reading aloud swaps
its glyph to what pressing it would do next (a pause bar while it speaks), puts
the verse it has reached in the tooltip, and reports how far through the chapter
it is; the rail draws that as a ring round the button, one conic gradient masked
to the edge, so advancing it costs a single custom property and nothing at all
when idle. Nothing polls: the feature calls `shell.refreshCommands()` as each
verse begins.

**The voices on the device are a document, built when it is opened.** A desktop
with the cloud voices installed has well over a hundred, and a list that long on
the Settings page would be built on every visit to a page nobody came to for
voices. So the settings row states the count — which is the answer most of the
time — and opening it builds the list, grouped by language with the language on
screen first, every row playable so a voice can be heard before it is chosen.
Closing the tab stops the sample and throws the list away; nothing is fetched
and nothing is stored.

Where the *cross-language* choice lives is the other design decision. It is not
a setting — a setting is a question asked of everybody, and most readers should
never wonder about this.
It is not behind a hidden gesture either, because a power-user feature nobody
can find twice is a feature that was not built. It is the last row of the voice
list: invisible unless you are already looking at voices, permanent once you
have. Reading in a crossed voice says so once when it starts, so an accent is
never mistaken for a fault.

## 3d-vi. Importing somebody else's file

The library lists four ways: by language, all, offline, and **yours** — the
translations the reader imported, which is the one group nothing else in the
list can be narrowed down to. Its two actions are icons (add, refresh) rather
than sentences: they take a quarter of the room and read at a glance in a
language this build has never been translated into.

A translation in one of the reader's own languages is marked and floated to the
top. That had never once fired: the catalog names a language by its 639-3 code
(`nob`, `fin`) and a browser asks for 639-1 (`nb`, `fi`), so the comparison was
between two codes that can never be equal. Both sides now go through
`core/langcode.js`. The same confusion drew a Burmese verse card in Georgia
with Latin line spacing, because `SCRIPT_FONTS` is keyed the way a browser is.

`library.importTranslation` is a second door, with its own key. The catalog
remains the only gate on `install`; nothing about that is weakened, and what
comes through the new door is marked as having done so (`source` on the stored
record, `local` rather than `unlisted` in the library — both are installed and
absent from the catalog, but one was brought in on purpose and the other has
been dropped by its publisher, and telling somebody their own file is "no
longer listed" reads as an accusation).

**The rule that keeps `core/formats/` from becoming a swamp: an adapter
converts, it never validates.** Each one turns a file it recognises into the
shape this app already reads, and `parseTranslation` then checks it against
`category.json` exactly as it checks a catalog file — same strictness, same
versification report. So an adapter is allowed to be lenient (guess a
delimiter, ignore an unknown marker, drop a footnote) because nothing it
produces is trusted; what it may not do is invent a verse.

| module | reads |
| --- | --- |
| `native` | this app's own JSON, bare or in an export envelope |
| `usfm` | the format translations are actually worked in; notes and cross-references are counted and dropped rather than read aloud as scripture |
| `xml` | Zefania, OSIS and USFX over `xmlread.js` — a pull reader written here because `DOMParser` belongs to a window and importing happens in a worker |
| `csv` | book, chapter, verse, text; the delimiter is sniffed, since a comma and a tab are not a question anybody wants asked about their own file |
| `books.js` | `GEN`, `Gen`, `1 Cor`, `Song of Solomon`, `19` → the canon's id, from the canon's own names plus the USFM and OSIS code tables. Nothing guesses: a name that matches nothing is named in the report |

The worker gained one job (`import`) that differs from `install` in one step —
where the text came from, and one conversion before the same validator.

**Being asked what the file is** is not a gate and not a survey. A file's
extension is a poor witness (`.xml` is three formats, `.txt` is any of them),
`sniff` ranks the adapters against the contents, `describe` fills in the name,
short name and language from the file's own first few kilobytes, and a reader
who accepts every default never types a character. Changing the format re-reads
the file so the boxes agree with the answer above them.

URL import is deliberately not here: the web target pins `connect-src` to the
catalog host, and widening that is a decision about the app's security posture
rather than a step in this feature.

## 3e. Search

No index is built at install time; the scan is a cursor over `chapters` in a worker.

- **Matching** (`app/core/search.js`) has three modes and one flag — offered to the reader as two independent switches (whole words, regular expression) plus case, since a pattern sets its own boundaries and the two cannot both apply: plain terms (ANDed, `"quoted"` as a phrase), whole words (a term must sit on a word boundary, tested with `\p{L}\p{N}_`), and a regular expression compiled as written. Case folds unless the reader asks otherwise. Plain and whole-word matching fold to NFD and strip Latin combining marks only; a pattern is matched against the text as written, since folding would change what it means. A pattern that cannot compile raises the reason, without the flags the reader never typed.
- **Scope**: a set of translations and a set of books. `store.scanChapters(identify, visit, { books, while })` opens one cursor per book when a set is given — the key is `[identify, book, chapter]`, so each book is one contiguous range — and asks `while()` between records, which is how a newer query abandons an older one mid-translation.
- **Counting is not limited**: the worker counts every match and keeps only the first `limit` rows (2,000). So the answer states how many verses matched, in how many chapters and books, and the tree lists every book that matched. Opening a book whose verses were past the limit searches that one book again, which is cheap.
- Results stream in batches of 40, each carrying the counts so far; the pane repaints at most once a frame.

Measured on three full-size translations: one translation 1.6 s, the same as a regular expression 0.3 s, all three 4.2 s, one book 0.17 s.

---

## 3d-vii. Writing a translation out

The readers in `core/formats/` turn somebody else's file into the shape this app
keeps; `core/formats/write.js` does the reverse. They live beside each other
because **two** features want the same emitters — the source view shows one
chapter as USFM, the library exports any selection as the same — and written
twice they would be two half-correct USFM emitters that disagreed about
footnotes.

A writer is given a `selection` (the metadata and the chapters, in canon order)
and nothing else: no store, no DOM, no network. So it is as testable as a
reader, and the test that actually keeps them honest is the round trip — write
it, read it back through the matching adapter, compare verse for verse. Native
JSON, USFM, USX, OSIS, Zefania and CSV all survive that; Markdown is a document
to read rather than a file to import, and says so.

`describeLoss(format)` is shown before the button, not after the download. This
app keeps text, a heading, a cross-reference line and a merge, because that is
what it uses; it does not keep USFM's paragraphing, its poetry indentation or
its footnotes. A converter that implied a round trip through here was lossless
would be lying.

**The source view** is where that machinery is visible: the same chapter as
USFM, as OSIS, as our own JSON, beside the reading. Markdown is the only
editable one, and that is a decision rather than an omission — the notes round
trip works because `## Notes` is a boundary the reader's own material sits
below, and USFM has no such line.

The format, the copy and the save are **one button in the crumb bar**, which
also shows which format is on. They were briefly a toolbar over the text, and
that was wrong twice: it spent a strip of the workspace on three controls, and
wrapping the textarea in a flex column inside a scrolling box left it half the
height it had — `.source` is sized by `height: 100%`, which needs a parent whose
height is definite. The view is the textarea again, and the controls sit beside
the translation-info button.

## 3d-viii. A translation as it is published

`engkjvcpb_usfx.zip` from eBible.org is eight files, and the scripture is one of
them. The others are what make an import feel like an installed translation:
`BookNames.xml` is what the translation calls each book, the DBL metadata is its
name, abbreviation, language and rights, and `copr.htm` is the copyright in
full. Asking a reader to unpack that and hand over one file is asking them to do
the assembly, and it throws the rest away.

- `services/zip.js` reads and writes zips with no dependency: a central
  directory is a few fixed-width fields, and `DecompressionStream('deflate-raw')`
  does the inflating. It is in `services/` rather than `core/` because it is
  asynchronous, and it is still tested in Node — against archives it did not
  write, since a reader tested only against its own writer agrees with itself.
- `core/formats/pack.js` works out what each file in a bundle is, converts the
  scripture (merging a bundle that is one file per book), and folds in the book
  names and the metadata. Files it does not use are named in the report rather
  than silently dropped.
- The import dialog asks nothing it can answer itself: the bundle's metadata
  fills the name, the short name and the language, and there is no format
  question because the archive settles it.

## 3d-ix. Strong's numbers

Two halves, and only one of them existed.

**Carrying the data.** The docs said word-level markup rode along in a `word`
field; `translation.js` rejected `word` as an unknown verse key, so a file
carrying one could not be installed, and the USFM importer dropped
`\w grace|strong="G5485"\w*` *because* it expected that field. A KJV published
with its Strong's numbers arrived without them, and the only machine-readable
source of them in the world was being discarded. They are now kept inline, as
`grace{G5485}`, which is the notation `core/strongs.js` has always read and the
reading surface has always rendered — from USFM, from USFX's `<w s="…">`, from
USX's `<char style="w" strong="…">` and from OSIS's `lemma="strong:…"`.

**Saying what one means.** `openStrongs` printed the code and the sentence "No
lexicon is installed" from the day it was written, because there was no lexicon
and nowhere to get one. There is now: `core/lexicon.js` defines the file (one
per testament, keyed by the bare number, every field but the definition
optional — the public-domain transcriptions come in a dozen shapes and one that
refused a file for want of a transliteration would be a lexicon nobody could
assemble), and `services/lexicon.js` fetches it from the catalog repository the
way language packs are fetched. It has an object store of its own because it is
megabytes where a language pack is forty lines, and `records` is read whole at
startup. Nothing is fetched until a number is pressed, and only the testament
that number belongs to: a reader of the Hebrew never downloads the Greek. Until
then the popover *offers the download* rather than stating a lack — a dead end
with a button on it is a different thing from a dead end.

A bare number with no H or G is not guessed at when both lexicons are held: 430
is God in Hebrew and something else in Greek.

## 3e-ii. Saying what the canon report means

`stats.books` is how many books a file holds; `diagnostics` is how it departs
from `category.json` — a book absent, a chapter past the canon's count, or a
chapter whose last covered verse is not the count the canon gives. The library
row used to render that as **"65 books · 50 differences"**, which raises two
questions and answers neither: is a book missing, and different how?

Both are knowable, so both are said. The row reads "65 of 66 books · 49
chapters a different length", the counts are kept *by kind* at install time
(the item list is capped, so a breakdown cannot be recovered from it later),
and the translation-info popover says in one paragraph what the canon is and
that a translation may legitimately differ from it.

**And some of those differences were ours.** A verse range — `\v 3-4` in USFM,
`number="3-4"` in USX, `id="2-3"` in USFX — was read as its first verse and the
range discarded, so every merged verse in a real edition became a chapter
reported as short. This app already has a field for exactly that (`merge`), and
the importers now record it. On an edition that merges fifty verses, fifty
"differences" were the importer's fault rather than the file's.

A licence gets a block of its own in that popover rather than a cell in the
facts grid, clamped to six lines with a press for the rest: the KJV Cambridge
Paragraph Bible's runs to five paragraphs, and in a narrow right-hand column it
turned the box into a scrolling wall.

## 3e-iii. Two pages that were doing too much

**Welcome** was four bordered panels, each with a heading, a paragraph and a
button of its own — a page that looks like a form to work through, shown to
somebody who has not yet decided to stay. It also offered four places to go
when only one of them can be first: without a translation there is nothing to
search, note or read. It is now one centred column with one button. The three
things worth knowing sit under it as facts rather than tasks — a line each, no
buttons, nothing to finish — and Help and Data and formats are a quiet pair of
links at the foot.

**Projects** took the card studio's manners, which is the same shape of
problem: a workspace whose controls should be at the top of it and out of the
way. The name, what can be added, and what happens to the whole project are one
strip of glyphs; the three "Add …" buttons used to sit at the *foot* of the
page, below however many entries there already were, which is exactly where
somebody adding a fourth is not looking. The two exports are one glyph with a
menu, because both are "take this out of here" and a strip is not the place to
explain the difference. The shelf's new and import are a plus and an arrow, and
when there is nothing on the shelf there is no shelf — a column headed
"Projects" saying "No projects yet" beside a page saying the same thing louder
is one empty state too many.

Where a glyph stands alone the name is its `title` and its `aria-label`, so
nothing is reachable only by recognising a symbol.

## 3e-iv. Looking a translation over

Six things worth knowing about a file turned out to be two different jobs, and
they are in two different places because putting them together makes neither
work.

**Navigation** is the headings and the book descriptions: a reader wants these,
and "where is the good shepherd" is a reading question. So the **Outline pane**
gained a scope — this chapter, this book, the whole translation — with a filter
once the list outgrows a screen. It already merged both kinds of heading for
the chapter in view; a heading index is that same list at a wider scope, which
is a control rather than a second pane. `book.info.desc` goes in the chapter
picker: by the time the chapters are on screen the book has been chosen, so one
line about it is context. That turned out to be the wrong room for it: a
chapter grid is a thing to aim at, and a paragraph over it is something to read
past sixty-six times. The description is in the book's own row in the report
instead.

**Inspection** is the merges, the differences, the missing books — facts about
the file rather than things in it. A reader never wants them; somebody
maintaining a translation wants all of them at once, with a way to jump to each.
That is the **Look closer** document: read once, wide, never consulted while
reading, which is exactly what a pane is not for. It also gives three surfaces
somewhere to lead. The library row has said "65 of 66 books · 49 chapters a
different length" since the last batch and the information popover has carried
the same counts, and until now both led nowhere — a count nobody can open is a
count nobody can act on.

**One pass, three answers.** The record keeps counts and a list of findings
capped at 400, so it can say whether anything is wrong and not where. Where is
in the chapters, which are already on this device, so the document opens on the
record and one press walks them — `core/examine.js`, a cursor like search's,
about a second. That single pass answers where the merges are, where the
headings are, and *every* difference from the canon rather than the first four
hundred, because the three questions are asked of the same rows. So there is
one button rather than one per section, and the stored cap stops being a
limitation to work around. The answer is kept per translation at feature scope
rather than inside the mount: a document is torn down when another tab is
shown, and a walk paid for once should not be paid for again for having looked
at a chapter.

**A book is the row.** The first version had a section per kind of finding —
differences here, merges there, headings somewhere else — which asks the reader
to hold three lists in their head to answer one question: *what about Isaiah?*
A book is the unit somebody works in, so the page is the figures and then one
list of books. Each row is the book's number, what the edition calls it, and
three counts (merged verses, headings, chapters whose length disagrees), and it
opens onto the chapters those counts came from, with the edition's own
description of the book above them. A book the file does not carry is still
listed, greyed, saying so — that it is absent is the news. `groupByBook` builds
that shape from a finished pass or, before one has run, from the record alone,
where merges and headings are `null` for *not known yet* rather than none.

The report leaves as a file: Markdown to read or attach, JSON to compare
against the same report taken later. Neither carries a timestamp — a report
that differs from last month's only in its date is a report nobody can diff.

The canon rules moved into that module and `parseTranslation` now calls them:
the check made at install and the check made later have to be the same code,
because two copies of a versification rule is two answers to one question and
no way to tell which is true.

The fixtures gained what a published edition actually has — a merged verse, a
pericope heading, a sub-heading, a book description. Everything that counts
those had until then only ever been exercised against zero.

## 3f. Rules that came out of defects

Each of these was a bug first. They are written down because in every case the
code that broke the rule looked perfectly reasonable, and in every case the
symptom appeared a long way from the cause.

- **A listener outlives what it closes over, so something has to own it.**
  `shell/fade.js` wired a `window` resize listener and two observers per
  scrollable node and offered no way to remove them. A chapter pane is rebuilt
  on every repaint — every chapter step, theme change, sidebar toggle and saved
  note — so reading through a book left hundreds of dead chapters alive, each
  held by its own handler, and hundreds of handlers running per resize. It is
  now a registry: one listener and one observer of each kind for the whole app,
  a set of the nodes they serve, and anything no longer in the document dropped
  on the next pass. `test/fade.test.js` wires two hundred repaints and asserts
  the set stays at one.

- **A dialog's safeguard has to survive its own keyboard handling.** The
  confirm dialog opens with the *cancel* button focused, precisely so that a
  reader pressing Enter out of habit destroys nothing — and then a `keydown`
  handler answered yes from anywhere and suppressed the cancel button's own
  activation. Enter on "Erase everything" erased everything with the focus ring
  sitting on Cancel. There is no Enter handler now; both buttons are buttons.

- **Repair the state, do not render around it.** `renderPanes` filtered
  translations that were no longer installed out of what it drew, leaving
  `state.translation` naming a deleted file. Everything that is not that
  function reads the state: closing the second column closed the first, and the
  outline, the card studio, reading aloud, the exports and the status bar all
  asked the store for a translation that had been deleted, once per repaint. It
  now writes the repaired list back and lets the re-render follow.

- **Geometry must ignore what is not on screen.** Both drag surfaces compared
  the dragged item against every sibling's rectangle, including the ones
  `fitStrip` had hidden — which measure zero and therefore sit to the left of
  everything, and so were "passed" by any movement at all. A five-pixel nudge
  sent a tab to the far end of the strip, and in the drawer layout, where only
  the active tab is visible, every drag did.

- **One record, one writer — or the writers have to agree.** `records.save`
  replaces the whole value, and the search feature wrote its record from two
  places: the pane and the Settings page. Each held a snapshot from when it was
  built, so whichever wrote last silently undid the other. The settings row now
  re-reads before patching, and the pane listens for changes it did not make.
  The same shape of race, one layer up, is why the composer captures its
  passage before an `await` and checks it after: a save that lands after the
  reader has moved re-files the note they were writing onto the chapter they
  moved to.

- **An abbreviation must never outrank a standard code.** `bookMatcher` built
  one flat table with first-writer-wins, filling it from the canon and then
  from the USFM and OSIS code tables, so that "a code table must never take a
  name away from" the canon. But `ISA` is the USFM code for Isaiah and nothing
  else, while the canon lists `I Sa` among 1 Samuel's abbreviations — and both
  normalise to `isa`. 1 Samuel is book 9 and was written first, so it kept the
  key: **every USFM and USFX import filed Isaiah's sixty-six chapters under 1
  Samuel and then reported Isaiah missing.** The table is built in three layers
  now — codes, then the canon's own names and short names, then the
  abbreviation variants — because a code is an identifier written by a machine
  and an abbreviation is a convenience somebody typed. A test walks all
  sixty-six books and asserts each answers to its own code, name and short
  name; `category.json` also lost `I Sa` and `IS` from 1 Samuel, the only two
  ambiguous entries in the whole canon.

- **A rebuilt element starts at the top, so the place has to be kept
  somewhere else.** Every tab change rebuilds the workspace — a chapter's
  leaves are built fresh, a document is unmounted and mounted again — and so
  does every state change, which is why saving a note while reading threw the
  scroll away too. `renderPanes` now notes where each pane was before it
  replaces anything and puts it back after, keyed by the tab *and its
  passage*: coming back to a tab is coming back to what was left there, while
  stepping to the next chapter in that tab is a different thing to look at and
  belongs at its beginning. A verse asked for still wins over both — the
  reader has just said where they want to be — and because a document's
  contents arrive after its mount, the restore tries again for a few frames
  rather than once into a box that is still empty.

- **An async render needs a generation, or the slower answer wins.**
  `renderPanes` awaits the store several times and runs on every state change,
  so two changes in a row put two runs in flight — and the older one, finishing
  last, put back what the state said when it started. Setting a value and then
  opening a document is exactly that shape, which is why "Look closer" opened
  an active, empty tab and worked on the second press. It now takes a run
  number and checks it after every await, the same rule `fillBook` and the
  outline pane already follow.

- **A label that cannot fit must be cut, not wrapped.** `.btn` is one line
  tall by declaration, and a label too long for the room — which is every
  label in a 240 px pane — wrapped onto a second line that the fixed height
  then sliced through, so the words read as spilling over the border. Three
  things were needed and only one of them is obvious: `white-space: nowrap`
  stops the wrap, `min-width: 0` is what lets a button in a flex row shrink at
  all (the default is its own content's width, which is precisely what has to
  give), and an *element* around the label is what `text-overflow` can act on
  — a bare string beside an icon is an anonymous flex item, which cannot be
  given an ellipsis and was being cut through the middle of a letter instead.
  `h()` wraps a button's plain-text children in that element, so the wrapping
  is in one place rather than at two hundred call sites and
  `h('button', { class: 'btn' }, icon('x'), 'Add the passage on screen')`
  still reads the way it did.

## 4. Catalog update flow

1. First run: bundled catalog, labelled with its date as potentially outdated.
2. Check remote on demand, or at most once per 24 h when online (`fetch` with `cache: 'no-cache'`).
3. Compare remote top-level `version` / `updated` with the stored catalog; unchanged → stop.
4. Validate shape; on failure show a clear error and keep the stored catalog (explicit, reported — not a silent fallback).
5. Per installed translation: `Number(catalog.version) > Number(installed.info.version)` → "update available". Installed but missing from catalog → kept, marked "no longer listed".
6. Download: validate `info.identify`, book ids against `category.json`, then atomic replace.

---

## 5. Parallel view

- Each translation yields spans per chapter: verse `n` → `[n, merge ?? n]`.
- Spans from all open columns are merged by overlap; each merged group is one **row**.
- A column cell holds all of its verses whose start falls inside the row. Missing verses render as an empty marked cell; extra verses form their own row.
- `story` and `verse.title` headings render inside the owning column's cell, so one translation's headings never shift other columns.
- A single CSS grid (one row per group) removes the need for JavaScript scroll syncing. Split panes, if kept, use row ids as scroll anchors.

---

## 6. Directory structure

```
app/                      shared UI — never imports from targets/
  boot.js  config.js  registry.js
  core/                   pure: category, catalog, translation, align, reference,
                          settings, search, annotations, markdown, plans, source,
                          strongs, time, aliases/
  services/               store (IndexedDB), library, settings, records, search,
                          transfer, aliases loader
  workers/                library.worker.js, search.worker.js
  core/  … plus passage.js (export shapes), projects.js (study projects)
  core/  … plus card.js (verse-card templates and layout)
  shell/                  chrome, workspace, reading, readingpanel, versebar, floats,
                          dragdrop, markdown, tree, modal, menu, confirm, colorpicker,
                          numberrow, settingrows, theme, i18n, icons, dom
  features/               library, settings, search, notes, bookmarks, composer,
                          notes-manager, tags, backlinks, outline, plans, graph,
                          board, ink, speech, verse-card, help (help/formats.js),
                          updates, export-chapter, export-passage, projects, welcome
  styles/                 shell.css (Phase 1 design system), views.css
targets/
  csp.js                  production Content-Security-Policy
  web/                    index.html, main.js, platform.js, theme.css, manifest, sw.js, shell-plugin.js
  desktop/                index.html, main.js, platform.js, theme.css, preload.js,
                          electron/ (index, window, state, protocol, ipc)
public/                   category.json, book.json, icons
assets/                   desktop packaging icon
scripts/aliases.mjs  scripts/version.mjs
test/                     unit + boundary tests, fixtures
  e2e/                    harness.mjs (server, browser, fixtures), app.test.mjs,
                          perf.mjs (measurements), desktop.mjs (packaged app)
.github/workflows/        check.yml on every push, release.yml on a v-tag
```

Toolchain: Vite 7 (electron-vite 5 supports Vite 5–7), electron-vite 5, Electron 44, electron-builder 26. No runtime dependencies.

## 6b. Phase 1 shell

`app/styles/shell.css` is Phase 1's stylesheet unchanged (1,578 lines: token ramp, chrome, reading surface, modal, status bar). The shell rebuilds that markup from the registry, so the design carries over without a rewrite:

- ribbon ← commands flagged `ribbon`; sidebar strips ← `registry.pane`; tabs ← chapters plus `registry.doc`.
- reading is the shell, not a feature: tabs, panes (leaves), breadcrumbs, the chapter surface.
- each verse, with its `story`/`title` headings and its references, is one `.vblock`; parallel rows are levelled per `alignChapter` group and synchronised scrolling follows the verse, not the pixel offset. Pane starts are levelled first, and `.chapter` carries a hair of padding so the first heading's margin cannot collapse through the measurement.
- theme, accent, verse layout, sync scroll and row alignment live in settings, so an export carries them.

Accent tokens are redefined per theme in the ramp (`html[data-theme="light"] …`), so a target's `theme.css` must match that specificity — a plain `:root` override loses.

Everything Phase 1 offered is now ported: notes and the composer, the notes manager, search, bookmarks, tags, backlinks, outline, the link graph, the study board, ink, reading plans, speech, verse cards, detached windows, tab and pane drag-and-drop, source mode and Strong's numbers.

Two behaviours are deliberately not Phase 1's:

- The board edits a card through a textarea laid over it, not `window.prompt`, which the desktop engine does not implement.
- The link graph is drawn from what the reader has touched — chapters carrying notes or bookmarks, the wikilinks between them, and the cross references printed in those chapters — rather than from a static table of chapter references. The whole canon would be tens of thousands of edges nobody can read.

## 7. Per-target customization

Rule: shared code under `app/` never asks which target it runs in. Variation is decided once, in `targets/*/main.js`, by **composition**.

```js
// targets/desktop/main.js
/**
 * Desktop (Electron renderer) build composition.
 *
 * Differs from the web build only in what is listed here: an extra feature
 * (export-chapter, which needs a native save dialog), the desktop platform
 * services, and the desktop theme.
 */
import { start } from '../../app/boot.js';
import library from '../../app/features/library/index.js';
import reader from '../../app/features/reader/index.js';
import parallel from '../../app/features/parallel/index.js';
import exportChapter from '../../app/features/export-chapter/index.js';
import { createPlatform } from './platform.js';
import './theme.css'; // after boot.js so target tokens override the defaults

start({
  root: document.getElementById('app'),
  createPlatform,
  features: [library, reader, parallel, exportChapter],
  config: {},
});
```

Mechanisms:

| Variation | Mechanism |
|---|---|
| Feature on/off | Feature modules listed in the target entry. Unlisted features are tree-shaken out of the bundle. |
| Colours, spacing, typography | `app/styles/tokens.css` defines tokens; `targets/*/theme.css` overrides them. CSS only. |
| Native capabilities (dialogs, window, menus, external links, auto-update) | `platform` object injected at boot; features declare `requires: ['saveFile']`. |
| URLs, defaults, limits | Plain `config` object passed to `start`; unknown keys are rejected. |

Feature module contract:

```js
export default {
  id: 'export-chapter',
  requires: ['saveFile'],            // platform capabilities
  setup(ctx) { /* register commands, views, settings via ctx */ },
};
```

- The command palette, menus and settings are built from registered features, so an absent feature leaves no dead UI.
- `boot` throws at startup if a listed feature requires a capability the platform lacks (fail-fast, clear message naming feature and capability).
- `test/boundaries.test.js` fails the suite if any file under `app/` imports from `targets/` or references `electron`, `window.lai`, `import.meta.env.MODE` or compares `platform.id`; and if `app/core/` touches the DOM, storage, `fetch` or `import.meta.glob`.

Verified: the web bundle contains no export-chapter code; the desktop accent token appears only in desktop CSS.

Trade-offs accepted:

- Two small `index.html` shells (one per target) duplicate a few lines of markup.
- The feature registry adds one level of indirection; it is justified by per-target feature sets and by the existing command-palette model.

---

## 8. Build outputs

| Path | Content |
|---|---|
| `dist/web/` | Static PWA build |
| `out/` | Compiled Electron main/preload/renderer |
| `release/` | Installers (`.exe`, `.dmg`, AppImage) |

All three are git-ignored.

---

## 9. Security (desktop)

- Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`; preload exposes only `saveFile`, `openExternal`, `appInfo`, `checkUpdate` and the window-frame hint.
- IPC handlers reject senders whose frame origin is not the app's; inputs are validated; `openExternal` accepts `https:` only.
- `app://` handler normalises paths and refuses anything outside `out/renderer/` (traversal requests return 404/403).
- Navigation away from the app origin is blocked; `window.open` to `https:` opens in the system browser.
- Production CSP on both targets: scripts and styles from `'self'`; `connect-src` limited to `'self'` and `https://raw.githubusercontent.com`.

---

## 9b. Failure states and recovery

Every failure has a named cause and, where one exists, an action.

| What fails | What the reader gets |
|---|---|
| A feature throws while registering | The other features start; one message names the feature and the reason. Reading is never lost to a study tool. |
| A pane or document throws on mount | The error is rendered inside that pane's own body; the rest of the chrome is untouched. |
| Storage is full (`QuotaExceededError`) | A message naming the remedy (remove a translation, free space) instead of the browser's wording. Install is one transaction, so the previous copy survives. |
| Another window upgrades the database | `onversionchange` closes the connection and reports it once, rather than letting every later write fail on its own. |
| An upgrade is blocked by an older window | The open is refused with a message naming the cause. |
| The application cannot start at all | A screen with the message, **Try again**, and a two-press **Erase stored data** (`indexedDB.deleteDatabase`), with what erasing costs stated. |
| A chapter is missing from a stored copy | Told apart from a translation that omits the book: when the translation's own index lists the book, the copy is incomplete, and **Download again** repairs it in place. |

`shell.repairTranslation(identify)` is the single repair path, shared by that callout and the translation information popover. It reinstalls over the held copy; a failed attempt leaves what is stored alone.

---

## 9c. Keeping the application current

Neither target downloads anything without being asked. The mechanism differs and `app/features/updates/` knows neither: both arrive as platform capabilities, and a target with neither gets no command.

| Target | Capability | Behaviour |
|---|---|---|
| Web | `updates` (`targets/web/register-sw.js`) | A new service worker installs and **waits**. The reader is offered *Reload*; `apply()` posts `take-over`, the worker calls `skipWaiting()`, and the one `controllerchange` reloads the page. Assets from two builds never mix. |
| Web | `install` | The browser's own install offer, held until the reader asks for it, rather than shown as a banner. |
| Desktop | `checkUpdate` | The **main process** queries the releases API and returns `{ current, latest, url, newer }`; versions are compared part by part, so `26.10.1` is newer than `26.9.24`. Nothing is downloaded or installed — the reader gets a link. |

The check runs at most once a day, silently unless there is something to say, and by hand from the palette. Running it in the main process keeps `connect-src` on the renderer limited to the catalog host.

---

## 9d. Distribution

- Releases are made in `laisiangtho/lab`, the same repository the desktop update check reads; the tag (`v26.09.24.3`) is the stamped version with a `v`, and the check compares the two.
- Targets: AppImage (x64), NSIS (x64), dmg + zip (arm64 and x64, ad-hoc signed). `.deb` and `.rpm` are left out because they require a maintainer address in metadata that ships with every copy.
- Window chrome: the system title bar is hidden only where the system still draws its own buttons — `hiddenInset` on macOS, `titleBarOverlay` on Windows. Linux keeps its title bar; the overlay is not drawn there, and a window with no close button is worse than an extra row. The renderer is told which arrangement it got (`platform.frame`) and reserves the corner.
- Window size, position and maximised state are kept in `userData/window.json`, outside the reader's library: they belong to this installation on this machine, and they are needed before the renderer exists. A position on a display that is no longer attached is discarded.
- `.github/workflows/ci.yml` runs the unit tests, the browser suite and the packaged desktop app on every push. `release.yml` runs when the head commit of a push to `master` starts with `release:web`, `release:desktop` or `release:all`: it calls the same checks as its gate, then publishes the web build to `laisiangtho.github.io`, the installers to a GitHub release, or both. A desktop release stays a draft until all three installers are attached, because the update check reads `releases/latest` and must never announce a download that is not there. `scripts/release-plan.mjs` reads the commit message and refuses a version the three stamped files disagree about; the procedure and its one-time setup are in `docs/releasing.md`.

---

## 9e. Reaching every kind of reader

The app is meant for people who use a Bible very differently — somebody reading
a chapter a night, a student comparing editions, a preacher preparing Sunday, a
translator checking a name, a programmer fixing a verse. What each of them
needs is not a different app but a different *way in*, and the cheapest way in
is the one they already know how to use.

| Way in | For whom it is the natural one |
|---|---|
| Buttons, panes, the books tree | anyone, and the only way that needs nothing learned |
| The command palette, by name | a reader who knows what a thing is called but not where it is |
| Palette verbs, by instruction | someone who works in a terminal and would rather type than point |
| References in shorthand (`ps 23`, `psa 3:2-4`) — palette, switcher and the books filter | anyone in a hurry; a student moving between passages |
| Projects and the composer | a preacher, a teacher, a student writing something |
| Export: Markdown, citation, sheet, file | whoever the writing is *for* — and every program that is not this one |
| "Data and formats", diagnostics, the alias tool | a translator, a maintainer, a programmer |

Two rules keep this from becoming several apps in a trenchcoat:

- **Nothing is reachable only by typing.** Every verb is also a button or a
  command; the Shortcuts document lists the verbs from the registry, so the
  keyboard route is discoverable from the pointer route.
- **Nothing is reachable only by pointing.** Everything on the settings page is
  also a command, and every document opens from the palette.

The first run says as much in four lines, and is in Help afterwards.

---

## 10. Verification performed

Everything below was run by hand during development. What is worth keeping now lives in `test/`, so it runs again on every change:

| Command | What it covers | Cost |
|---|---|---|
| `npm test` | 68 unit and boundary tests — parsers, alignment, references, settings, language packs, registry, and the rules that keep `app/` target-agnostic | ~1 s |
| `npm run test:e2e` | 35 ordered checks against the real `dist/web` build in a browser, with the catalog repository answered from generated fixtures: first run, install and read, the reading panel, parallel alignment, three-source names with the canon as the accessible name, language packs fetched once and cached, marks surviving a translation switch, tab reorder and detach leaving nothing behind, sidebar rows and the empty-sidebar rail, search, the narrow layout, reload persistence, the install report, a damaged copy repairing itself, and the search engine — its counts, its tree, whole-word and regular-expression matching, a pattern that cannot compile, and a scope narrowed to one book that survives a reload; that the chrome selects nothing and keeps the arrow while the scripture selects normally; that the books tree opens and shuts as asked with following on and off; and that the text panel stays on screen without a scrollbar at every interface size. Batch J added six: that the first run shows the greeting and hands over to the Library; that the palette takes an instruction (`mark exo 2:3` bookmarks and goes there, twice to undo it) while a bare word is still the command of that name; that a passage leaves as Markdown with a note written through the palette inside it; that a project keeps a passage, its verses and what was written about it across a reload; that Settings gathers the rows Search and the Books pane own, keeps what cannot be undone at the bottom, and reaches the reading surface; that dragging the accent colour repaints nothing and keeps only the colour it stopped on; and that Escape answers the confirmation dialog with no. Batch K added six more: that a card is drawn from the verses that were chosen rather than the first one; that the card studio draws the template it is given and keeps the templates across a reload; that a ribbon button can be dragged to a new place, dragged off the rail and put back by its undo, and still runs its command on a plain press; that a pane strip too narrow for its tabs hides them whole, counts them on its button and lists the row; that a document repainting itself keeps the reader's scroll position; and that every document has exactly one box that scrolls. It ends by asserting that nothing was logged and nothing 404'd but the language pack the fixtures deliberately omit | ~150 s |
| `npm run test:desktop` | The packaged Electron application started under a display: the `app://` protocol, the preload bridge, the shell rendering, and a clean console | ~10 s |
| `npm run test:perf` | Measurements at full size (below) | ~30 s |

The browser driver (`playwright-core` and a Chromium build) is the one thing the unit tests do not need, so it is optional: the suites report why they cannot run and skip rather than fail.

### Measured at full size

Three complete Bibles — the canon's real chapter and verse counts, verses of realistic length — on one machine, so the numbers are for comparison over time rather than a promise:

| | |
|---|---|
| start with nothing installed, to the catalog | 714 ms |
| install a 4.0 MB translation | 482 ms |
| install a 10.1 MB translation (Burmese, UTF-8) | 1,199 ms |
| open Psalm 119 (176 verses) | 356 ms |
| next chapter | 145 ms |
| three parallel panes over Psalm 119 | 233 ms |
| scroll that to the end | 424 ms |
| search one full translation (31,102 verses) | 1,185 ms (results stream as they are found) |
| the same, as a regular expression | 239 ms |
| search all three (93,000 verses) | 3,061 ms |
| the same, narrowed to one book | 150 ms |
| reload with everything open | 752 ms |

Measured again at 26.09.26.4. Nothing in the reading or search path changed, but the machine these run on is shared and its figures drift by a factor of two between runs on the same build — the second run of the same suite gave 1,873 ms for one translation and 4,853 ms for three. The numbers are therefore worth comparing only against numbers taken the same afternoon. The bundle grew from 238 kB to 300 kB (98 kB gzipped) across this batch and the last.

### Earlier, by hand

- `node --test`: 61 tests (parsers, alignment, references, settings, registry, boundaries).
- Web build in Chromium: catalog check against remote shape, install of three translations through the worker, reader with story headings / titles / merged labels / cross-reference navigation, parallel alignment, command palette, reload persistence, offline reload through the service worker; no console errors.
- Settings in Chromium: persistence across reload; export file contents; import into a clean profile restoring position and installing the two listed translations; a foreign file refused with a clear message; IndexedDB v1 → v2 upgrade keeping an existing translation record.
- Ported shell in Chromium: chrome renders (ribbon, both sidebars, workspace, status bar), books tree with chapter chips, Library and Settings as tabs, reading with story headings / verse titles / merged "17–18" labels / resolved references, parallel panes aligned to the pixel across a merge, synchronised scrolling landing on the same verse, quick switcher, command palette, hash routing, theme cycling and reload restoring the passage; no console errors.
- Search, notes and bookmarks in Chromium: scans over the real Tedim and NIV data (timings above), phrase queries, streamed results grouped by chapter, jump-and-flash from a result, verse bar actions, a bookmark and note surviving a translation switch and a reload, export carrying them, import into a clean profile restoring them, and the IndexedDB v2 → v3 upgrade keeping existing translations and settings.
- Workspace and chrome in Chromium: ribbon and status bar toggles, sidebar drag (264 → 344 px) and `Ctrl+B`, reading panel (size, line height, layout), source mode round trip and a refused scripture edit, tab reorder, detach into a float (with a doc inside), float move and dock, pane swap, and a reload restoring tabs, typography, widths and panes.
- Study features in Chromium: composer opens (`Ctrl+J`), autosaves, renders wikilinks and tags in preview and closes back into the same note; the tags pane lists and filters by tag; the links pane reports linked and unlinked mentions; the outline lists a chapter's headings; the notes manager filters, sorts and exports; the link graph builds from notes, bookmarks and cross references and simulates without burning frames when hidden; the board adds, edits, moves and clears cards; the ink layer attaches over the reading surface, draws, and its strokes reach the `records` store; the verse bar carries note, bookmark, copy, compose, read aloud and verse card; a reading plan starts and shows today's chapters. No console errors.
- Dragging in Chromium, after the capture fix: a sidebar pane tab moved from the left strip to the right and persisted as `panesRight`, pane tabs reordered within a strip, a tab pulled out into a float, the float dragged back over the strip (dock hint shown) and docked, the float's size readout during a resize, and the reading panel staying still while its own controls are clicked.
- Sidebar rows in Chromium: a pane dropped into a row body split the sidebar into two rows with their own strips, both panes visible at once, the divider traded height between them (433/433 → 273/593) and persisted; a pane dragged to the other sidebar kept its mounted state; the arrangement survived a reload.
- Tab dragging in Chromium, after the rewrite: reorder committed and persisted, a second drag immediately after still worked, nothing left behind (no caret, no body class), detach showed the window preview and detached, and the float docked back.
- Status bar, help and pickers in Chromium: word and verse counts for the chapter in view (787 words, 30 verses), storage readout with quota and eviction state in its tooltip, Help with 11 task cards, Shortcuts generated from the registry with its filter, About reporting the build and what is stored, the breadcrumb picker listing 39 books then 40 chapters and navigating, scroll fades setting their variables, and the accent picker surviving a reload.
- Typography and script in Chromium: the reading panel's stepper, slider and number field each move the rendered text (the variables had been landing on the body, where the ramp could not see them); a Burmese translation renders at `lang="my"` with a Myanmar face and 1.26× the reader's line height, and the reading panel still moves that; testament names, book names, tabs, breadcrumbs and the books tree all read in the translation's language.
- Chrome states in Chromium: on a document tab, four status-bar controls and the chapter-only ribbon buttons are disabled and `body[data-tab]` reads `doc`; a detached window resized to 540×440 reopened at 540×440, and again at 540×440 after a reload.
- Script and chrome in Chromium: with a Burmese translation primary, tab 30 px, breadcrumb 22 px and tree row 26 px — the same as in Latin — with chapter numbers in Burmese digits (`၃`, `၃/၅၀`) in the tabs, breadcrumbs, tree and picker.
- Library, sidebars and narrow layout in Chromium: filter (64 → 11 translations), the three views, the offline view; a sidebar emptied of every pane showing a 132 px drop rail mid-drag and taking a pane back; at 720 px the navigation pill, the app pill, a single visible tab with its switcher (5 entries), the left drawer opening and the scrim closing it, and the drawer released on the way back to a wide window.
- Language packs in Chromium: with the Danish and Burmese translations installed, one request per language (`dan`, `mya`), both cached under `lang:` and none re-requested after a reload; `Danske / Det Gamle Testamente / Første Mosebog / 20` and `ယုဒသန် / ဓမ္မဟောင်းကျမ်း / ကမ္ဘာဦးကျမ်း / ၂၀` in the crumb bar, each crumb carrying `Old Testament`, `Genesis`, `Genesis 20` as its accessible name, and the same on tabs, tree rows and chapter chips.
- Desktop build in Electron 44 (Xvfb): `app://lai` origin, bridge present, no Node in renderer, desktop theme applied, install, export through a stubbed save dialog, path traversal refused, and every ported pane and verse action present.
