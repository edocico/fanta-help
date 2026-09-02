/**
 * The two questions every keyboard shortcut of document 2 §6 has to ask before
 * it fires, in one place rather than in each of the four listeners.
 */

/**
 * Whether the key went to something that is being typed into.
 *
 * The table of §6 says `/` works "fuori dai campi di testo" and `?` works
 * "ovunque", but the second cannot mean *literally* everywhere: the auction
 * screen opens with the focus already in the search box, and a `?` typed there —
 * hunting for a player whose name one is unsure of — would open the reference
 * panel over the auction instead of reaching the field. "Ovunque" is about the
 * views, not about the caret.
 *
 * `isContentEditable` covers the third case that is neither an input nor a
 * textarea. There is none in the app today, and leaving it out is how there
 * comes to be one that swallows its own question mark.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * `Ctrl` on Linux and Windows, `Cmd` on macOS — the "Ctrl/Cmd" of every row in
 * §6 — and never both, so a chord with an extra modifier does not count as one.
 *
 * Read off the user agent at runtime and not off a build flag: the project is
 * developed on Fedora and on macOS from the same tree, and a platform wired in
 * at build time is exactly what the "due macchine" section of CLAUDE.md forbids.
 *
 * The parameter is the pair of flags and not a `KeyboardEvent`, because both
 * kinds of listener ask: the window ones, which get the DOM event, and the
 * `onKeyDown` of an input, which gets React's synthetic one. Structural typing
 * makes them the same question.
 *
 * Which modifier matters, rather than "either one": on macOS `Ctrl+H` is the
 * Emacs binding for backspace and `Ctrl+P` for the previous line, both live
 * inside a text field. Accepting `ctrlKey` there would open the history *and*
 * delete a character from the search box, in the same keystroke, on the one
 * screen where that costs a player.
 */
export function isMod(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  const mac = navigator.userAgent.includes('Mac')
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}
