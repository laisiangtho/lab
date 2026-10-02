/**
 * Reading aloud, through the device's own voices.
 *
 * Nothing is assumed: the command is offered whatever happens, but says plainly
 * why it cannot read — no speech engine, no language on the translation, or no
 * installed voice for that language. A voice is matched on the language rather
 * than on the exact tag, so "ar" serves ar-SA and ar-EG, and a file that names
 * its language "mya" is matched against a voice that calls itself "my-MM"
 * (`core/langcode.js` is what makes those the same language).
 *
 * **A voice may also be chosen across languages.** Reading the King James in a
 * Norwegian voice sounds odd, and it is also the only way some people can be
 * read to at all: a language with no voice of its own is read by whichever
 * voice comes closest, and which one that is belongs to the person listening.
 * It is not a setting, because a setting is a question asked of everybody; it
 * is the last row of the voice list, which is a question asked only of somebody
 * already looking at voices. Once chosen it is remembered against the
 * translation rather than the language, so an odd pairing stays where it was
 * wanted, and the status bar names the voice that is speaking so that nobody
 * has to wonder why their Bible has an accent.
 *
 * One controller owns the state, so every entry point — ribbon, verse bar,
 * command palette — drives the same playback.
 */

import { languageName, sameLanguage, toTag } from '../../core/langcode.js';
import {
  chooseVoice, forgetVoice, isCrossed, parseVoiceMemory, rememberVoice, voicesForLanguage,
} from '../../core/voices.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

const KEY = 'voices';
const RATE = 0.95;

export default {
  id: 'speech',
  setup(ctx) {
    const { records, registry, shell, state, store } = ctx;

    const speech = { mode: 'idle', book: null, chapter: null, verses: null, numbers: [], at: 0, lang: '', voice: null };
    let voices = [];

    const available = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
    const memory = () => parseVoiceMemory(records.get(KEY, null));

    function loadVoices() {
      try {
        voices = available() ? (window.speechSynthesis.getVoices() ?? []) : [];
      } catch {
        voices = [];
      }
    }

    /**
     * The language of the text on screen, as a tag a voice can be matched
     * against, plus the name to say it by.
     *
     * `info.language.code` is the tag — two letters where the language has
     * them. `info.language.name` is the 639-3 code and reads as gibberish to a
     * reader, so `text` is what any message uses.
     */
    async function subject() {
      const { translation } = state.get();
      if (!translation) return { identify: '', tag: '', name: '' };
      const meta = await store.getMeta(translation);
      return {
        identify: translation,
        tag: toTag(meta.info.language.code),
        name: meta.info.language.text || meta.info.language.code,
      };
    }

    const voicesFor = (tag) => voicesForLanguage(voices, tag);
    const voiceFor = (about) => chooseVoice(memory(), about, voices);

    /** Why reading aloud is unavailable, in words; empty when it is available. */
    async function blocker(at = null) {
      if (!available()) return L('err.noSpeech');
      const about = at ?? await subject();
      if (!about.tag) return L('hint.noLang');
      if (!voiceFor(about)) return L('hint.noVoice', { lang: about.name });
      return '';
    }

    function markSpoken(verse) {
      for (const node of document.querySelectorAll('.verse.is-hit')) node.classList.remove('is-hit');
      if (verse === null) return;
      const leaf = document.querySelector('.leaf[data-role="primary"] .leaf-scroll');
      const node = leaf?.querySelector(`.vblock[data-verse="${verse}"]`);
      if (!node) return;
      node.classList.add('is-hit');
      try {
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        // Scrolling must never break the chain of utterances that calls this.
      }
    }

    async function speakFrom(book, chapter, verse) {
      const about = await subject();
      const why = await blocker(about);
      if (why) { shell.notify(why, 'error'); return; }
      const { translation } = state.get();
      const verses = await store.getChapter(translation, book, chapter);
      if (!verses) { shell.notify(L('ch.noText', { tr: shell.workspace.primaryName() }), 'error'); return; }

      const numbers = Object.keys(verses).map(Number).sort((a, b) => a - b);
      const index = verse ? numbers.indexOf(verse) : 0;
      const voice = voiceFor(about);
      window.speechSynthesis.cancel();
      Object.assign(speech, {
        mode: 'playing', book, chapter, verses, numbers, at: index < 0 ? 0 : index,
        lang: about.tag, voice,
      });
      // A voice from another language is a choice somebody made, and saying
      // which voice is speaking is how they can tell it apart from a fault.
      if (voice && !sameLanguage(voice.lang, about.tag)) {
        shell.notify(L('msg.readingIn', { voice: voice.name, lang: about.name }));
      }
      shell.refreshCommands?.();
      speakCurrent();
    }

    function speakCurrent() {
      if (speech.mode !== 'playing') return;
      if (speech.at >= speech.numbers.length) { stop(); shell.notify(L('msg.ended')); return; }
      const number = speech.numbers[speech.at];
      markSpoken(number);
      // The ring advances a verse at a time; nothing polls.
      shell.refreshCommands?.();

      const utterance = new SpeechSynthesisUtterance(speech.verses[number].text);
      utterance.rate = RATE;
      // The voice's own tag, not the text's: an engine handed "en" and a
      // Norwegian voice may resolve the language and drop the voice.
      utterance.lang = speech.voice?.lang || speech.lang || '';
      // The language alone lets the engine choose; the voice refines it when accepted.
      if (speech.voice) {
        try { utterance.voice = speech.voice; } catch { /* rejected: the language default stands */ }
      }
      utterance.onend = () => {
        if (speech.mode !== 'playing') return;
        speech.at++;
        speakCurrent();
      };
      utterance.onerror = () => { stop(); shell.notify(L('err.speech'), 'error'); };
      window.speechSynthesis.speak(utterance);
    }

    function stop() {
      Object.assign(speech, { mode: 'idle', book: null, chapter: null, verses: null, numbers: [], at: 0, voice: null });
      if (available()) window.speechSynthesis.cancel();
      markSpoken(null);
      shell.refreshCommands?.();
    }

    async function toggle() {
      if (speech.mode === 'playing') {
        speech.mode = 'paused';
        window.speechSynthesis.pause();
        shell.refreshCommands?.();
        return;
      }
      if (speech.mode === 'paused') {
        speech.mode = 'playing';
        window.speechSynthesis.resume();
        shell.refreshCommands?.();
        return;
      }
      const { book, chapter } = state.get();
      await speakFrom(book, chapter, null);
    }

    /** One row of the picker. */
    const voiceRow = (voice, current) => ({
      title: voice.name,
      sub: `${voice.lang}${voice.localService ? '' : ` · ${L('val.online')}`}`,
      icon: voice === current ? 'check' : 'voice',
      voice,
    });

    async function keepVoice(about, voice) {
      const own = sameLanguage(voice.lang, about.tag);
      await records.save(KEY, rememberVoice(memory(), about, voice));
      shell.notify(own
        ? L('msg.state', { what: L('cmd.voice'), value: voice.name })
        : L('msg.voiceCrossed', { voice: voice.name, lang: about.name }));
    }

    /**
     * The voice list: this language's voices, and a way out of that.
     *
     * The last row is the whole feature. It is not hidden behind a setting or a
     * gesture, because a power-user feature nobody can find twice is a feature
     * that was not built — and it is not on the settings page either, because a
     * reader who has never wondered about this should never be asked.
     */
    async function pickVoice({ all = false } = {}) {
      const about = await subject();
      if (!available()) { shell.notify(L('err.noSpeech'), 'error'); return; }
      if (!about.tag) { shell.notify(L('hint.noLang'), 'error'); return; }
      if (!voices.length) { shell.notify(L('err.noVoices'), 'error'); return; }

      const current = voiceFor(about);
      const own = voicesFor(about.tag);
      const list = all || !own.length ? voices : own;
      const crossed = isCrossed(memory(), about.identify);

      const items = list.map((v) => voiceRow(v, current));
      if (!all && own.length) {
        items.push({
          title: L('cmd.anyLanguage'),
          sub: L('cmd.anyLanguageHint', { lang: about.name }),
          icon: 'library',
          more: true,
        });
      }
      if (crossed) {
        items.unshift({
          title: L('cmd.ownLanguage', { lang: about.name }),
          sub: L('cmd.ownLanguageHint'),
          icon: 'undo',
          clear: true,
        });
      }

      shell.pick({
        placeholder: all ? L('cmd.voiceAny') : L('cmd.voice'),
        items,
        onPick: async (item) => {
          if (item.more) { await pickVoice({ all: true }); return; }
          if (item.clear) {
            await records.save(KEY, forgetVoice(memory(), about.identify));
            shell.notify(L('msg.state', { what: L('cmd.voice'), value: about.name }));
            return;
          }
          await keepVoice(about, item.voice);
        },
      });
    }

    /**
     * What the ribbon button should look like right now.
     *
     * Reading aloud is the one command whose state is a process rather than a
     * switch, and a button that looks the same idle, speaking and paused is a
     * button that has to be pressed to find out. So it answers with the glyph for
     * what pressing it would do next, what that is in words, and how far
     * through the chapter the voice has got — which the rail draws as a ring.
     */
    function buttonState() {
      if (speech.mode === 'idle') return { on: false, icon: 'audio', title: L('cmd.read') };
      const through = speech.numbers.length ? speech.at / speech.numbers.length : 0;
      return {
        on: true,
        icon: speech.mode === 'playing' ? 'pause' : 'play',
        title: speech.mode === 'playing'
          ? L('cmd.readPause', { at: speech.numbers[speech.at] ?? '', of: speech.numbers.length })
          : L('cmd.readResume'),
        progress: through,
      };
    }

    registry.command({
      id: 'speech.toggle',
      title: L('cmd.read'),
      icon: 'audio',
      ribbon: true,
      needsChapter: true,
      state: buttonState,
      run: () => toggle().catch((err) => shell.notify(err.message, 'error')),
    });
    registry.command({ id: 'speech.stop', title: L('cmd.stopReading'), icon: 'stop', run: stop });
    registry.command({
      id: 'speech.voice',
      title: L('cmd.voice'),
      // Not the same glyph as reading aloud. Two buttons that look identical
      // and do different things are one button that sometimes does the wrong
      // thing — and on a rail two centimetres wide there is nothing else to
      // tell them apart by.
      icon: 'voice',
      run: () => pickVoice().catch((err) => shell.notify(err.message, 'error')),
    });

    /**
     * Every voice this device has, shown only when somebody asks.
     *
     * A list of voices is the sort of thing that reads as generous and behaves
     * as a tax: on a desktop with the cloud voices installed it is well over a
     * hundred rows, each one a name nobody recognises, and building it into the
     * Settings page would mean building it on every visit to a page nobody came
     * to for voices. So the row states the count — which is the answer most of
     * the time — and the list exists only while it is open.
     *
     * It is grouped by language, marked where it is the language on screen, and
     * every row can be heard: a voice is a sound, and a list of names is a poor
     * way to choose one. Nothing is fetched and nothing is kept.
     */
    function voicesDoc(el) {
      loadVoices();
      const wrap = h('div', { class: 'vx' });
      el.append(h('section', { class: 'doc doc-full vx-doc' }, wrap));

      let filter = '';
      let sample = null;
      let about = { identify: '', tag: '', name: '' };

      const stop = () => {
        if (!available()) return;
        try { window.speechSynthesis.cancel(); } catch { /* nothing to cancel */ }
        sample = null;
      };

      /** Say one line in this voice, so the reader hears what they are picking. */
      function tryOut(voice) {
        if (!available()) return;
        stop();
        const line = new SpeechSynthesisUtterance(L('vx.sample'));
        line.voice = voice;
        line.lang = voice.lang;
        line.rate = RATE;
        line.onend = () => { if (sample === voice.voiceURI) { sample = null; paint(); } };
        sample = voice.voiceURI;
        window.speechSynthesis.speak(line);
        paint();
      }

      function paint() {
        const q = filter.trim().toLowerCase();
        const all = voices.filter((v) => !q
          || `${v.name} ${v.lang} ${languageName(v.lang)}`.toLowerCase().includes(q));

        const groups = new Map();
        for (const voice of all) {
          const key = toTag(voice.lang);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(voice);
        }
        // The language on screen first: it is the one the reader is here about.
        const order = [...groups.entries()].sort(([a], [b]) => {
          const mine = (code) => (about.tag && sameLanguage(code, about.tag) ? 0 : 1);
          return mine(a) - mine(b) || languageName(a).localeCompare(languageName(b));
        });

        fill(wrap,
          h('header', { class: 'doc-head' },
            h('h1', { class: 'inline-title' }, L('vx.title')),
            h('p', { class: 'muted' }, available()
              ? L('vx.lede', { n: voices.length, langs: groups.size })
              : L('err.noSpeech')),
            h('div', { class: 'vx-tools' },
              h('div', { class: 'field' }, icon('search'), h('input', {
                type: 'search', spellcheck: 'false', value: filter,
                placeholder: L('vx.filter'), 'aria-label': L('vx.filter'),
                oninput: (e) => { filter = e.currentTarget.value; paint(); },
              })),
              h('span', { class: 'grow' }),
              sample
                ? h('button', { class: 'btn', onclick: () => { stop(); paint(); } }, icon('stop'), L('vx.stop'))
                : null)),
          order.length
            ? order.map(([code, list]) => h('div', { class: 'vx-group' },
              h('h2', {},
                languageName(code) || code,
                h('span', { class: 'vx-n' }, String(list.length)),
                about.tag && sameLanguage(code, about.tag)
                  ? h('span', { class: 'badge badge-hint' }, L('vx.onScreen'))
                  : null),
              h('ul', { class: 'vx-list' }, list.map((voice) => h('li', {
                class: `vx-item${sample === voice.voiceURI ? ' is-playing' : ''}`,
              },
                h('button', {
                  class: 'vx-try', title: L('vx.try'), 'aria-label': L('vx.try'),
                  onclick: () => (sample === voice.voiceURI ? (stop(), paint()) : tryOut(voice)),
                }, icon(sample === voice.voiceURI ? 'stop' : 'play')),
                h('span', { class: 'vx-name' }, voice.name),
                h('span', { class: 'vx-tag' }, voice.lang),
                voice.localService
                  ? h('span', { class: 'badge badge-ok' }, L('vx.offline'))
                  : h('span', { class: 'badge' }, L('val.online')),
                voice.default ? h('span', { class: 'badge badge-hint' }, L('vx.default')) : null)))))
            : h('p', { class: 'empty-hint' }, voices.length ? L('vx.noHits', { query: filter.trim() }) : L('err.noVoices')));
      }

      subject().then((found) => { about = found; paint(); }).catch(() => paint());
      paint();
      const refresh = () => { loadVoices(); paint(); };
      try { window.speechSynthesis?.addEventListener('voiceschanged', refresh); } catch { /* older engine */ }
      return () => {
        stop();
        try { window.speechSynthesis?.removeEventListener('voiceschanged', refresh); } catch { /* as above */ }
      };
    }

    registry.doc({ id: 'voices', title: L('vx.title'), icon: 'waveform', mount: voicesDoc });

    registry.setting({
      id: 'speech.voices',
      section: 'reading',
      order: 60,
      build: (ui) => {
        loadVoices();
        return ui.action({
          name: L('vx.title'),
          hint: available() ? L('vx.settingHint') : L('err.noSpeech'),
          value: available() ? String(voices.length) : '—',
          label: L('cmd.open'),
          glyph: 'waveform',
          disabled: !available(),
          onClick: () => shell.openDoc('voices'),
        });
      },
    });

    registry.command({
      id: 'speech.voices',
      title: L('vx.title'),
      icon: 'waveform',
      opens: 'voices',
      run: () => shell.openDoc('voices'),
    });

    registry.verseAction({
      id: 'speech.fromVerse',
      title: L('cmd.readFrom'),
      icon: 'audio',
      run: (p) => speakFrom(p.book, p.chapter, p.verse).catch((err) => shell.notify(err.message, 'error')),
    });

    if (available()) {
      loadVoices();
      // Voices arrive asynchronously and differ per device and browser.
      const refresh = () => loadVoices();
      try {
        window.speechSynthesis.addEventListener('voiceschanged', refresh);
      } catch {
        window.speechSynthesis.onvoiceschanged = refresh;
      }
    }

    // Reading stops when the passage under it changes.
    state.subscribe((value) => {
      if (speech.mode === 'idle') return;
      if (value.book !== speech.book || value.chapter !== speech.chapter) stop();
    });

    // Leaving the page mid-utterance would otherwise keep the engine talking.
    window.addEventListener('pagehide', () => { if (speech.mode !== 'idle') stop(); });
  },
};
