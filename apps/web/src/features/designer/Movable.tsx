import { use, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Crop, Move, RotateCcw } from 'lucide-react'
import type { DesignBox } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { useDesigner } from './context'
import { PageCtx } from './page-context'
import { snapBox, type Box } from './snap'

/**
 * Canva's move and resize (step 4), for one photo or text on a page.
 * - A photo: press and drag anywhere on it to move it; tap to pick it; the
 *   corners resize it; double-tap (or Crop) to move the picture inside.
 * - A text: it is typed into where it stands, so it moves by the grip that
 *   shows at its corner (hover or while typing), and resizes by its corners.
 * While dragging, the item snaps to the page's centre and margins and a pink
 * line shows the guide. Where it went is kept per item (`page.data.layout`);
 * Reset puts it back in the layout's place.
 */
export function Movable({
  k,
  kind,
  children,
  onTap,
  className,
  style,
}: {
  k: string
  kind: 'photo' | 'text'
  children: ReactNode
  onTap?: (() => void) | undefined
  className?: string | undefined
  style?: CSSProperties | undefined
}) {
  const page = use(PageCtx)
  const ed = useDesigner()
  const el = useRef<HTMLDivElement>(null)
  const drag = useRef<null | {
    mode: 'move' | 'size'
    px: number
    py: number
    b0: DesignBox
    base: Box
    sx: number
    sy: number
    moved: boolean
  }>(null)
  const b: DesignBox | undefined = page?.layout[k]
  const transform =
    b && (b.dx || b.dy || b.s !== 1) ? `translate(${b.dx}px, ${b.dy}px) scale(${b.s})` : undefined
  const live = !!page?.editable && !!ed
  const id = page ? `${page.pageId}:${k}` : k
  const selected = live && ed?.selected === id
  const cropping = live && ed?.cropping === id

  if (!live || !page || !ed) {
    return (
      <div className={className} style={{ ...style, transform, transformOrigin: 'center' }}>
        {children}
      </div>
    )
  }

  /** The item's box on the page now, in page pixels. */
  const measure = (): Box => {
    const r = el.current!.getBoundingClientRect()
    const sheet = el.current!.closest('.designer-sheet')!.getBoundingClientRect()
    const z = ed.scale || 1
    return {
      x: (r.left - sheet.left) / z,
      y: (r.top - sheet.top) / z,
      w: r.width / z,
      h: r.height / z,
    }
  }

  function start(e: PointerEvent, mode: 'move' | 'size', sx = 1, sy = 1) {
    if (!ed || !page) return
    drag.current = {
      mode,
      px: e.clientX,
      py: e.clientY,
      b0: b ?? { dx: 0, dy: 0, s: 1 },
      base: measure(),
      sx,
      sy,
      moved: false,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function move(e: PointerEvent) {
    const d = drag.current
    if (!d || !page || !ed) return
    const z = ed.scale || 1
    const ddx = (e.clientX - d.px) / z
    const ddy = (e.clientY - d.py) / z
    if (!d.moved && Math.abs(ddx) + Math.abs(ddy) < 3 / z) return
    d.moved = true
    if (d.mode === 'move') {
      const snapped = snapBox({ ...d.base, x: d.base.x + ddx, y: d.base.y + ddy })
      page.setGuides(snapped.guides)
      page.setBox(k, {
        dx: Math.round(d.b0.dx + snapped.x - d.base.x),
        dy: Math.round(d.b0.dy + snapped.y - d.base.y),
        s: d.b0.s,
      })
    } else {
      // Grow by the larger pull of the two directions, keeping the shape.
      const grow = Math.max((ddx * d.sx) / d.base.w, (ddy * d.sy) / d.base.h)
      const s = Math.min(4, Math.max(0.2, Math.round(d.b0.s * (1 + 2 * grow) * 100) / 100))
      page.setBox(k, { ...d.b0, s })
    }
  }

  function end() {
    const d = drag.current
    drag.current = null
    page?.setGuides([])
    if (d && !d.moved && d.mode === 'move') {
      ed?.select(id)
      onTap?.()
    }
  }

  const handle = (sx: 1 | -1, sy: 1 | -1, pos: string) => (
    <span
      key={pos}
      role="presentation"
      onPointerDown={(e) => {
        // The corner's own press: the photo under it must not start a move too.
        e.stopPropagation()
        start(e, 'size', sx, sy)
      }}
      onPointerMove={move}
      onPointerUp={end}
      className={cn(
        'designer-chrome absolute z-10 size-4 rounded-full border-2 border-violet-500 bg-white shadow',
        pos,
      )}
      style={{ cursor: sx === sy ? 'nwse-resize' : 'nesw-resize' }}
    />
  )

  return (
    <div
      ref={el}
      data-movable={id}
      className={cn(
        'group/move relative',
        kind === 'photo' && !cropping && 'cursor-move',
        className,
      )}
      style={{ ...style, transform, transformOrigin: 'center', zIndex: selected ? 5 : undefined }}
      onPointerDown={
        kind === 'photo' && !cropping
          ? (e) => {
              if ((e.target as HTMLElement).closest('button, input, label')) return
              start(e, 'move')
            }
          : undefined
      }
      onPointerMove={kind === 'photo' ? move : undefined}
      onPointerUp={kind === 'photo' ? end : undefined}
      onDoubleClick={kind === 'photo' ? () => ed.setCropping(id) : undefined}
    >
      {children}
      {(selected || cropping) && (
        <span
          className="designer-chrome pointer-events-none absolute -inset-1 rounded-[inherit] border-2 border-violet-500"
          style={{ borderStyle: cropping ? 'dashed' : 'solid' }}
        />
      )}
      {selected && !cropping && (
        <>
          {handle(-1, -1, '-left-2 -top-2')}
          {handle(1, -1, '-right-2 -top-2')}
          {handle(-1, 1, '-bottom-2 -left-2')}
          {handle(1, 1, '-bottom-2 -right-2')}
        </>
      )}
      {kind === 'text' && (
        <button
          type="button"
          aria-label="Move this text"
          title="Drag to move"
          onPointerDown={(e) => start(e, 'move')}
          onPointerMove={move}
          onPointerUp={end}
          className={cn(
            'designer-chrome absolute -left-10 top-0 z-10 flex size-8 cursor-move items-center justify-center rounded-full bg-violet-600 text-white shadow transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover/move:opacity-100',
          )}
        >
          <Move className="size-4" />
        </button>
      )}
      {(selected || cropping) && (
        <div
          className="designer-chrome absolute -top-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#1f2023] px-1.5 py-1 text-white shadow-lg"
          style={{ fontFamily: 'system-ui, sans-serif' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {kind === 'photo' && (
            <button
              type="button"
              onClick={() => ed.setCropping(cropping ? null : id)}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-white/15"
            >
              <Crop className="size-4" /> {cropping ? 'Done' : 'Crop'}
            </button>
          )}
          {b && (
            <button
              type="button"
              onClick={() => page.setBox(k, null)}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-white/15"
              title="Put it back in its place"
            >
              <RotateCcw className="size-4" /> Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
