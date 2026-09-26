/**
 * The "Data and formats" document: what this app reads, what it writes, and
 * where it keeps it.
 *
 * Why it exists: everything here is somebody else's file. A translation is a
 * JSON file in a public repository, the book names come from language packs
 * beside it, and a reader's own material leaves as a file they own. Anyone who
 * wants to correct a verse, add a translation, translate the book names into
 * their own language, or read their notes with another program should be able
 * to, and none of that is possible from a screenshot of the interface.
 *
 * Why the prose is here and not in i18n.js: this is reference documentation
 * for file formats whose field names are themselves fixed English JSON keys.
 * Translating the surrounding sentences while the keys stay put would produce
 * a document that is half-translated and, for the reader who most needs it,
 * harder to check against the real file than the English. The interface around
 * it — the title, the tab, the buttons — goes through i18n like everything
 * else.
 */

/**
 * @typedef {{ heading: string, body: string[], sample?: { caption: string, code: string } }} Section
 */

/** @returns {Section[]} */
export function formatSections({ config }) {
  return [
    {
      heading: 'Where the text comes from',
      body: [
        'Nothing is bundled but the skeleton. On first run the app reads a catalog — a list of every translation that exists, with its identify, its language and its version — and each translation is downloaded whole, once, when a reader asks for it. After that it is read from this device and never fetched again until its version changes.',
        `This build reads its catalog from ${config.catalogUrl} and its translations from ${config.translationUrl}. Both are plain files over HTTPS: no account, no key, no tracking, and nothing that this app can see that a browser could not.`,
        'The skeleton — which books exist, in which order, with how many chapters and verses — is category.json, and it ships with the app. It is the canon every file is checked against.',
      ],
      sample: {
        caption: 'category.json (an entry)',
        code: `{
  "testament": [{ "id": 1, "name": "Old Testament" }],
  "book": [
    {
      "id": 19, "testament": 1, "name": "Psalm", "shortname": "Ps",
      "chapters": 150,
      "verse": [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, …]
    }
  ]
}`,
      },
    },
    {
      heading: 'A translation file',
      body: [
        'One file is one translation, keyed by book and chapter and verse. The numbers are the canon\'s numbers, which is what lets two translations be read side by side and a note written in one be found in the other.',
        'A verse may carry a heading (title) and a merge, where one verse of the canon is set as a range in this translation. Word-level markup — Strong\'s numbers and the like — rides along in word, and is shown only where a reader asks for it.',
        'Everything else is description: who published it, in what year, under what terms. The app shows all of it, unedited, on the translation\'s info panel.',
      ],
      sample: {
        caption: '{identify}.json',
        code: `{
  "info": {
    "identify": "kjv1611", "version": 3, "name": "King James Version",
    "shortname": "KJV", "year": "1611", "publisher": "…", "copyright": "Public domain",
    "language": { "text": "English", "name": "English",
                  "iso": { "639-1": "en", "639-3": "eng" }, "textdirection": "ltr" }
  },
  "digit": ["0","1","2","3","4","5","6","7","8","9"],
  "book": {
    "19": {
      "chapter": {
        "23": {
          "verse": {
            "1": { "text": "The LORD is my shepherd; I shall not want.",
                   "title": "A Psalm of David" },
            "2": { "text": "…", "merge": 3 }
          }
        }
      }
    }
  }
}`,
      },
    },
    {
      heading: 'Names in your own language',
      body: [
        'Book and testament names, and the digits a language counts in, live in language packs beside the translations — one per language, named by its ISO 639-3 code. A pack is small, fetched once and kept, and it is what makes the Books pane read in Burmese while the interface stays in English.',
        `This build looks for packs at ${config.langPackUrl}.`,
        'A translation may also carry its own names, in language and testament, and those win over the pack: the file knows what it calls its own books. Where neither exists the canon\'s English is used, which is why every button also carries the English name as its title — a name you cannot read is not a name.',
      ],
      sample: {
        caption: 'iso-{code}.json',
        code: `{
  "digit": ["၀","၁","၂","၃","၄","၅","၆","၇","၈","၉"],
  "testament": { "1": "ဓမ္မဟောင်းကျမ်း", "2": "ဓမ္မသစ်ကျမ်း" },
  "book": { "1": "ကမ္ဘာဦး", "19": "ဆာလံ" }
}`,
      },
    },
    {
      heading: 'What the app says about a file',
      body: [
        'A translation is checked against the canon as it is installed, and what departs from it is recorded rather than hidden: a chapter that is not in the canon, a book that is missing, a chapter whose verses do not add up. None of it stops the translation being read — real files have real gaps — but all of it is on the translation\'s info panel, with a button to write the whole list to a file.',
        'This is the report to send to whoever maintains the text. It names the book, the chapter, and what was expected against what was found.',
      ],
      sample: {
        caption: 'a diagnostics entry',
        code: `{ "type": "versification", "book": 19, "chapter": 23, "expected": 6, "actual": 5 }`,
      },
    },
    {
      heading: 'What is kept on this device',
      body: [
        'Everything is in one IndexedDB database named lai-siangtho, in the browser or in the desktop app\'s own profile. Nothing is sent anywhere: there is no account and no server that belongs to this app.',
        'translations and chapters hold what was downloaded. settings holds one record. notes and marks hold your own writing, keyed by passage. records holds what a feature owns and settings has no schema for — the open project, the search filters, which panes follow the reading.',
        'Storage can be reclaimed by the browser under pressure. Settings has a button that asks the browser to keep it, and the honest answer — granted, refused, or unknown — is shown beside it.',
      ],
    },
    {
      heading: 'Your material, as a file',
      body: [
        'Settings → Your material writes one JSON file with your settings, every note, every bookmark, and the list of translations you have installed — never the translation text itself, which is megabytes and is public anyway. Importing it on another device restores the lot and offers to download the translations again.',
        'The file is plain, documented by its own field names, and versioned: a build that does not understand its schema refuses it rather than half-reading it.',
      ],
      sample: {
        caption: 'the export envelope',
        code: `{
  "app": "lai-siangtho", "schema": 1, "exportedAt": "2026-09-26T…",
  "settings": { "theme": "dark", "readingSize": 18, … },
  "library": { "translations": [{ "identify": "kjv1611", "version": 3 }] },
  "data": { "notes": [ … ], "marks": [ … ] },
  "records": { "projects": { … } }
}`,
      },
    },
    {
      heading: 'A project, as a file',
      body: [
        'A study project exports as its own file, so a sermon or a course can be handed to somebody else, kept in a repository, or read by another program. Passages are references, never copied text — which is why a project opens correctly in whichever translation the person who receives it reads.',
        'The same project also exports as Markdown, for anyone who does not use this app at all.',
      ],
      sample: {
        caption: 'a project file',
        code: `{
  "app": "lai-siangtho", "kind": "project", "schema": 1,
  "project": {
    "name": "Advent 1", "summary": "…",
    "entries": [
      { "kind": "passage", "book": 19, "chapter": 23, "verse": 1, "to": 3,
        "text": "The shepherd image." },
      { "kind": "todo", "text": "Check the Hebrew", "done": false }
    ]
  }
}`,
      },
    },
    {
      heading: 'Adding your own',
      body: [
        'Because the catalog and the translations are ordinary files at ordinary addresses, a translation is added by putting a file beside the others and naming it in the catalog. A correction is a pull request against that file. A language pack is forty lines of names.',
        'The repository is github.com/laisiangtho/lab, and the text lives in the repository the catalog points at. Nothing about the format is private to this app, and anything that reads JSON can read it.',
      ],
    },
  ];
}
