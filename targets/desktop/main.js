/**
 * Desktop (Electron renderer) build composition.
 *
 * Differs from the web build only in what is listed here: an extra feature
 * (export-chapter, which needs a native save dialog), the desktop platform
 * services, and the desktop theme.
 */
import { start } from '../../app/boot.js';
import library from '../../app/features/library/index.js';
import settings from '../../app/features/settings/index.js';
import search from '../../app/features/search/index.js';
import notes from '../../app/features/notes/index.js';
import bookmarks from '../../app/features/bookmarks/index.js';
import composer from '../../app/features/composer/index.js';
import notesManager from '../../app/features/notes-manager/index.js';
import tags from '../../app/features/tags/index.js';
import backlinks from '../../app/features/backlinks/index.js';
import outline from '../../app/features/outline/index.js';
import plans from '../../app/features/plans/index.js';
import graph from '../../app/features/graph/index.js';
import board from '../../app/features/board/index.js';
import ink from '../../app/features/ink/index.js';
import speech from '../../app/features/speech/index.js';
import verseCard from '../../app/features/verse-card/index.js';
import help from '../../app/features/help/index.js';
import exportChapter from '../../app/features/export-chapter/index.js';
import updates from '../../app/features/updates/index.js';
import exportPassage from '../../app/features/export-passage/index.js';
import projects from '../../app/features/projects/index.js';
import report from '../../app/features/report/index.js';
import welcome from '../../app/features/welcome/index.js';
import { createPlatform } from './platform.js';
import './theme.css'; // after boot.js so target tokens override the defaults

start({
  root: document.getElementById('app'),
  createPlatform,
  features: [library, settings, search, notes, bookmarks, composer, notesManager, tags, backlinks, outline, plans, graph, board, ink, speech, verseCard, help, exportChapter, updates, exportPassage, projects, report, welcome],
  config: {},
});
