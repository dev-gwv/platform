import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DesignDoc } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { DesignPageView, PAGE_H, PAGE_W } from './DesignPageView'

/** A page drawn at A4 and scaled down to its column's width. */
export function Scaled({ hidden = false, children }: { hidden?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / PAGE_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="relative w-full">
      <div
        className={cn(
          'relative overflow-hidden rounded-sm shadow-lg ring-1 ring-black/10',
          hidden && 'opacity-40',
        )}
        style={{ width: PAGE_W * scale, height: PAGE_H * scale }}
      >
        <div
          style={{
            width: PAGE_W,
            height: PAGE_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * What printing gives: the shown pages, full size, nothing to edit. On
 * <body> itself, in normal flow, so each page takes its own margin-free A4
 * sheet (`@page designer` in styles.css).
 */
export function PrintCopy({ doc }: { doc: DesignDoc }) {
  return createPortal(
    <div className="designer-print" aria-hidden>
      {doc.pages
        .filter((p) => !p.hidden)
        .map((p) => (
          <div key={p.id} className="designer-print-page">
            <DesignPageView
              page={p}
              theme={doc.theme}
              editable={false}
              onChange={() => undefined}
            />
          </div>
        ))}
    </div>,
    document.body,
  )
}
