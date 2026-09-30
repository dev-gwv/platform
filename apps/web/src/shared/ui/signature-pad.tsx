import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { Button } from './button'
import { cn } from './cn'

/**
 * Sign with a finger (or a mouse). Amber and dashed until something is
 * drawn, green once it is; `onChange` gets a PNG data URL, or null after
 * Clear. The drawing is kept at the pad's own size, so a signature stays a
 * few kilobytes.
 */
export function SignaturePad({
  onChange,
  className,
  label = 'Sign here',
}: {
  onChange: (png: string | null) => void
  className?: string
  label?: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [signed, setSigned] = useState(false)

  // Size the drawing surface to the box on screen, sharp on high-density screens.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const { width, height } = el.getBoundingClientRect()
    el.width = Math.round(width * ratio)
    el.height = Math.round(height * ratio)
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
    const ctx = e.currentTarget.getContext('2d')
    if (ctx && last.current) {
      // A tap leaves a dot, not nothing.
      ctx.beginPath()
      ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2)
      ctx.fillStyle = '#111827'
      ctx.fill()
    }
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext('2d')
    const p = point(e)
    if (ctx) {
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
    last.current = p
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    setSigned(true)
    onChange(canvas.current?.toDataURL('image/png') ?? null)
  }

  function clear() {
    const el = canvas.current
    el?.getContext('2d')?.clearRect(0, 0, el.width, el.height)
    setSigned(false)
    onChange(null)
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        className={cn(
          'relative rounded-lg border-2 border-dashed bg-white',
          signed ? 'border-success/60 border-solid' : 'border-warning/60 bg-warning/5',
        )}
      >
        <canvas
          ref={canvas}
          aria-label={label}
          role="img"
          className="block h-40 w-full cursor-crosshair touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {!signed && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {label}
          </span>
        )}
        <span className="pointer-events-none absolute bottom-3 left-4 right-4 border-b border-foreground/20" aria-hidden />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={signed ? 'text-success' : 'text-muted-foreground'}>{signed ? 'Signed' : 'Use your finger or mouse'}</span>
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!signed}>
          <Eraser className="mr-1 size-3.5" /> Clear
        </Button>
      </div>
    </div>
  )
}
