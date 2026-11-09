import { createContext } from 'react'
import type { DesignBox, DesignTextStyle } from '@ipc/contracts'
import type { Guide } from './snap'

/** A4 at 96 dpi: the size every page is drawn at, then scaled to the screen. */
export const PAGE_W = 794
export const PAGE_H = 1123

/** The page being drawn: its id, its text settings and moved items, and how to change them. */
export interface PageCtxValue {
  pageId: string
  editable: boolean
  styles: Record<string, DesignTextStyle>
  layout: Record<string, DesignBox>
  setBox: (key: string, box: DesignBox | null) => void
  setGuides: (g: Guide[]) => void
}

export const PageCtx = createContext<PageCtxValue | null>(null)
