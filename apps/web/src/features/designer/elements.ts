import type { DesignBox, DesignElement, DesignElementKind, DesignPageData } from '@ipc/contracts'
import { PAGE_H, PAGE_W } from './page-context'

/**
 * What a studio adds to a page itself (Canva's Text and Elements): each kind
 * starts at a size that reads well on an A4 page and lands in the middle of
 * the page, a little lower each time so a second one never hides the first.
 */
const SIZES: Record<DesignElementKind, { w: number; h: number; text: string }> = {
  heading: { w: 560, h: 90, text: 'Add a heading' },
  subheading: { w: 480, h: 50, text: 'Add a subheading' },
  text: { w: 440, h: 60, text: 'Add a little bit of text' },
  photo: { w: 360, h: 260, text: '' },
  line: { w: 360, h: 3, text: '' },
  box: { w: 260, h: 160, text: '' },
  circle: { w: 200, h: 200, text: '' },
}

export const ELEMENT_NAMES: Record<DesignElementKind, string> = {
  heading: 'Heading',
  subheading: 'Subheading',
  text: 'Text',
  photo: 'Photo frame',
  line: 'Line',
  box: 'Box',
  circle: 'Circle',
}

export const isTextElement = (k: DesignElementKind) =>
  k === 'heading' || k === 'subheading' || k === 'text'

/** The key an added item's place and text style are kept under. */
export const elementKey = (id: string) => `el.${id}`

export function newElementId(): string {
  return Math.random().toString(36).slice(2, 10) || 'e1'
}

/** A new item of this kind, centred on the page (stepped down past those already there). */
export function newElement(kind: DesignElementKind, existing: number, id = newElementId()): DesignElement {
  const s = SIZES[kind]
  const step = (existing % 8) * 28
  return {
    id,
    kind,
    text: s.text,
    photo: { url: '', x: 50, y: 50, zoom: 1 },
    color: '',
    x: Math.round((PAGE_W - s.w) / 2),
    y: Math.round((PAGE_H - s.h) / 2 + step - 84),
    w: s.w,
    h: s.h,
  }
}

export function addElement(d: DesignPageData, el: DesignElement): DesignPageData {
  return { ...d, elements: [...d.elements, el].slice(-40) }
}

export function updateElement(d: DesignPageData, id: string, patch: Partial<DesignElement>): DesignPageData {
  return { ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
}

/** Takes an added item off the page, with its place and text style. */
export function removeElement(d: DesignPageData, id: string): DesignPageData {
  const key = elementKey(id)
  const layout = { ...d.layout }
  const styles = { ...d.styles }
  delete layout[key]
  delete styles[key]
  return { ...d, elements: d.elements.filter((e) => e.id !== id), layout, styles }
}

/** A copy of an added item, 24 px down and right, with the same style. */
export function duplicateElement(d: DesignPageData, id: string, newId = newElementId()): DesignPageData {
  const el = d.elements.find((e) => e.id === id)
  if (!el || d.elements.length >= 40) return d
  const box = d.layout[elementKey(id)]
  const copy: DesignElement = {
    ...el,
    id: newId,
    x: el.x + (box?.dx ?? 0) + 24,
    y: el.y + (box?.dy ?? 0) + 24,
  }
  const layout = { ...d.layout }
  if (box && box.s !== 1) layout[elementKey(newId)] = { dx: 0, dy: 0, s: box.s }
  const styles = { ...d.styles }
  const st = d.styles[elementKey(id)]
  if (st) styles[elementKey(newId)] = st
  return { ...d, elements: [...d.elements, copy], layout, styles }
}

/** Moves any item by the arrow keys (1 px, or 10 with Shift), within the layout's limits. */
export function nudge(d: DesignPageData, key: string, dx: number, dy: number): DesignPageData {
  const b: DesignBox = d.layout[key] ?? { dx: 0, dy: 0, s: 1 }
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v))
  return {
    ...d,
    layout: { ...d.layout, [key]: { dx: clamp(b.dx + dx, 1200), dy: clamp(b.dy + dy, 1600), s: b.s } },
  }
}
