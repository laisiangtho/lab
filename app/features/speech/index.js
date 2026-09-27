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

import { sameLanguage, toTag } from '../../core/langcode.js';
import {
  chooseVoice, forgetVoice, isCrossed, parseVoiceMemory, rememberVoice, voicesForLanguage,
} from '../../core/voices.js';
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

    registry.command({
      id: 'speech.toggle',
      title: L('cmd.read'),
      icon: 'audio',
      ribbon: true,
      needsChapter: true,
      // A button that says whether it is doing the thing it offers.
      state: () => speech.mode === 'playing',
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
