import type { Ref, RefCallback } from 'react'

/**
 * Let a floating list scroll while a dialog is open.
 *
 * A Radix dialog or sheet locks the page with react-remove-scroll, which
 * listens on the document and cancels every wheel and touchmove whose target
 * is outside the dialog's own box. Dropdowns, pickers and menus are portalled
 * to <body> (so a scrolling drawer cannot clip them), which puts them outside
 * that box: on a phone the plan list in Assign plan, the calendar's year list
 * and every picker in the lead drawer could not be swiped (audit, 18 Nov).
 *
 * Stopping the two events on the list itself means the lock never sees them,
 * so the list scrolls the way it would anywhere else. Pair it with
 * `overscroll-contain` on the list so reaching its end does not move the page
 * behind.
 */
export function keepScrollInside(el: HTMLElement): () => void {
  const stop = (e: Event) => e.stopPropagation()
  el.addEventListener('wheel', stop, { passive: true })
  el.addEventListener('touchmove', stop, { passive: true })
  return () => {
    el.removeEventListener('wheel', stop)
    el.removeEventListener('touchmove', stop)
  }
}

/** A callback ref that does `keepScrollInside`, merged with the caller's own ref. */
export function scrollInsideRef<T extends HTMLElement>(other?: Ref<T>): RefCallback<T> {
  return (el) => {
    if (typeof other === 'function') other(el)
    else if (other) (other as { current: T | null }).current = el
    if (!el) return
    const undo = keepScrollInside(el)
    return () => {
      undo()
      if (typeof other === 'function') other(null)
      else if (other) (other as { current: T | null }).current = null
    }
  }
}
