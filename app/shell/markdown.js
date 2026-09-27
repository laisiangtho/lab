/**
 * Rendering the note Markdown into DOM, with Phase 1's classes.
 *
 * Wikilinks resolve through the same reference parser the cross-references
 * use, so `[[Genesis 1]]`, `[[Gen 1:3]]` and a translation's own book names all
 * work. An unresolved link is shown as unresolved rather than dropped.
 */

import { parseBlocks, parseInline } from '../core/markdown.js';
import { parseReferences } from '../core/reference.js';
import { h } from './dom.js';
import { wireRef } from './reflink.js';

/**
 * @param {string} text
 * @param {{ resolver: object, onLink(ref: object): void, onTag(tag: string): void }} handlers
 * @returns {HTMLElement}
 */
export function renderMarkdown(text, handlers) {
  const out = h('div', { class: 'md' });
  for (const block of parseBlocks(text)) {
    if (block.type === 'heading') {
      out.append(h(`h${Math.min(block.level + 1, 6)}`, { class: `md-h md-h${block.level}` }, inline(block.text, handlers)));
    } else if (block.type === 'quote') {
      out.append(h('blockquote', { class: 'md-quote' }, inline(block.text, handlers)));
    } else if (block.type === 'list') {
      out.append(h(block.ordered ? 'ol' : 'ul', { class: block.ordered ? 'md-ol' : 'md-ul' },
        block.items.map((item) => h('li', {}, inline(item, handlers)))));
    } else {
      out.append(h('p', { class: 'md-p' }, inline(block.text, handlers)));
    }
  }
  return out;
}

function inline(text, handlers) {
  return parseInline(text).map((token) => {
    switch (token.type) {
      case 'strong': return h('strong', { class: 'md-strong' }, token.text);
      case 'em': return h('em', { class: 'md-em' }, token.text);
      case 'code': return h('code', { class: 'md-code' }, token.text);
      case 'tag': return h('button', { class: 'tag-inline', onclick: () => handlers.onTag?.(token.text) }, `#${token.text}`);
      case 'link': return h('a', { class: 'wikilink', href: token.href, target: '_blank', rel: 'noopener noreferrer' }, token.text);
      case 'wikilink': return wikilink(token.text, handlers);
      default: return token.text;
    }
  });
}

function wikilink(target, handlers) {
  const ref = handlers.resolver ? parseReferences(target, handlers.resolver)[0] : null;
  if (!ref?.refs) return h('span', { class: 'wikilink is-unresolved', title: `Unresolved link: ${target}` }, target);
  // A link in a note behaves as a link in a chapter does: in place by default,
  // in a new tab on request, and readable without leaving the note at all.
  return wireRef(h('button', { class: 'wikilink' }, target), ref.refs[0], {
    open: (at, options) => handlers.onLink?.(at, options),
    peek: handlers.onPeek ?? null,
  });
}
