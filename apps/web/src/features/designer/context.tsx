import { createContext, use } from 'react'
import type { DesignPhoto } from '@ipc/contracts'

/**
 * What the editor shares with every page (0297): which text has the cursor
 * (the top bar shows its size, alignment and colour) and which photo frame
 * is picked (a photo tapped in Uploads goes there). Outside the editor (the
 * client's page, the PDF, a template's thumbnail) there is none.
 */
export interface ActiveText {
  pageId: string
  key: string
}

export interface PickedFrame {
  id: string
  apply: (p: DesignPhoto) => void
}

export interface DesignerCtx {
  activeText: ActiveText | null
  setActiveText: (t: ActiveText | null) => void
  pickedFrame: string | null
  pickFrame: (f: PickedFrame | null) => void
  /** Put a photo in the picked frame (a tap in Uploads). */
  applyToPicked: (p: DesignPhoto) => void
  /** A photo file dropped on a frame: compressed, uploaded, kept in the library. */
  uploadPhoto: (file: File) => Promise<DesignPhoto | null>
}

export const DesignerContext = createContext<DesignerCtx | null>(null)
export const useDesigner = () => use(DesignerContext)

/** The drag payload of a library photo. */
export const PHOTO_DRAG_TYPE = 'application/x-design-photo'
