/**
 * True on a phone or tablet: the main pointer is a finger.
 *
 * A picker that focuses its search box on open is quick with a keyboard, but
 * on a phone that focus raises the on-screen keyboard over the very list the
 * person opened it to tap (audit, 18 Nov). Pickers ask this and, on a touch
 * screen, open with the list in view; a tap on the search box still types.
 */
export function isTouchScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}
