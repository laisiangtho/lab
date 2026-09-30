/**
 * A key combination as this device writes it, for any feature that shows one:
 * Help, the Shortcuts table, the guide.
 */

const APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

/** "Mod+p" as this device writes it. */
export function keyLabel(keys) {
  return keys
    .replace('Mod', APPLE ? '⌘' : 'Ctrl')
    .replace('Alt', APPLE ? '⌥' : 'Alt')
    .replace('Shift', '⇧')
    .replace('ArrowRight', '→')
    .replace('ArrowLeft', '←')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .split('+');
}
