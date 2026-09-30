/**
 * Injects a Content-Security-Policy <meta> into index.html for production
 * builds only; the Vite dev server needs inline styles and a websocket that the
 * production policy does not allow.
 */
export function csp(policy) {
  const content = Object.entries(policy).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
  return {
    name: 'lai-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head' }],
  };
}

/** Policy shared by both targets; each target may extend it. */
export const basePolicy = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  // Any https address. The Library imports from an address the reader types,
  // and lists getBible and eBible.org besides the catalog, so no fixed list of
  // hosts is right. What keeps the page safe is unchanged: scripts come only
  // from the app itself (script-src 'self'), so nothing here can be sent
  // anywhere by code the app did not ship. Plain http is still refused.
  'connect-src': ["'self'", 'https:'],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
});
