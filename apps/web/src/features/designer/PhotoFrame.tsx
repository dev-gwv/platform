import { useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Move, Trash2, Upload } from 'lucide-react'
import type { DesignPhoto } from '@ipc/contracts'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'
import { PHOTO_DRAG_TYPE, useDesigner } from './context'

/**
 * A frame on the page that holds one photo (Quotation Designer), the way a
 * Canva frame works:
 * - drop a photo on it: from Uploads, or straight from the computer (a big
 *   camera file is made small first);
 * - tap it to pick it, then tap a photo in Uploads to put it there;
 * - drag the photo inside the frame to choose what shows, and zoom it from
 *   Move and zoom.
 * An empty frame says "Add your photo"; on paper and on the client's copy an
 * empty frame is a quiet tint.
 */
export function PhotoFrame({
  frameId,
  photo,
  onChange,
  editable,
  accent,
  className,
  style,
}: {
  frameId: string
  photo: DesignPhoto
  onChange: (p: DesignPhoto) => void
  editable: boolean
  accent: string
  className?: string | undefined
  style?: CSSProperties | undefined
}) {
  const ctx = useDesigner()
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const pan = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const picked = ctx?.pickedFrame === frameId

  async function pickFile(file: File | undefined) {
    if (!file || !ctx) return
    setBusy(true)
    try {
      const p = await ctx.uploadPhoto(file)
      if (p) onChange(p)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setOver(false)
    const url = e.dataTransfer.getData(PHOTO_DRAG_TYPE)
    if (url) return onChange({ url, x: 50, y: 50, zoom: 1 })
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name),
    )
    if (file) void pickFile(file)
    else if (e.dataTransfer.files.length) toast.error('Drop a photo (JPG, PNG or WebP).')
  }

  // Dragging the photo inside its frame moves what shows, like Canva's crop.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    pan.current = { x: photo.x, y: photo.y, px: e.clientX, py: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const p = pan.current
    const el = box.current
    if (!p || !el || !photo.url) return
    const dx = e.clientX - p.px
    const dy = e.clientY - p.py
    if (!p.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    p.moved = true
    const r = el.getBoundingClientRect()
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
    onChange({
      ...photo,
      x: clamp(p.x - ((dx / r.width) * 100) / photo.zoom),
      y: clamp(p.y - ((dy / r.height) * 100) / photo.zoom),
    })
  }
  function onPointerUp() {
    const p = pan.current
    pan.current = null
    if (p && !p.moved) ctx?.pickFrame(picked ? null : { id: frameId, apply: onChange })
  }

  const img = photo.url ? (
    <img
      src={photo.url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute inset-0 size-full select-none object-cover"
      style={{
        objectPosition: `${photo.x}% ${photo.y}%`,
        transform: `scale(${photo.zoom})`,
        transformOrigin: `${photo.x}% ${photo.y}%`,
      }}
    />
  ) : (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2"
      style={{ background: `linear-gradient(135deg, ${accent}22, ${accent}44)`, color: accent }}
    >
      {editable && (
        <>
          <ImagePlus className="size-10" aria-hidden />
          <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: 600 }}>
            Add your photo
          </span>
          <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, opacity: 0.8 }}>
            Drop one here, or tap
          </span>
        </>
      )}
    </div>
  )

  if (!editable) {
    return (
      <div className={cn('relative overflow-hidden', className)} style={style}>
        {img}
      </div>
    )
  }

  return (
    <div
      ref={box}
      data-photo-frame
      className={cn(
        'group/photo relative touch-none overflow-hidden',
        photo.url && 'cursor-grab active:cursor-grabbing',
        className,
      )}
      style={{
        ...style,
        outline: over || picked ? '4px solid #8b5cf6' : undefined,
        outlineOffset: -4,
      }}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes(PHOTO_DRAG_TYPE) ||
          e.dataTransfer.types.includes('Files')
        ) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {img}
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />
      {busy && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white">
          <Loader2 className="size-10 animate-spin" aria-hidden />
          <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: 16 }}>
            Making it small and uploading…
          </span>
        </div>
      )}
      {!busy && !photo.url && (
        <button
          type="button"
          className="designer-chrome absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/60 bg-black/60 px-4 py-2 text-white shadow hover:bg-black/80"
          style={{ fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: 600 }}
          onClick={() => input.current?.click()}
        >
          Upload a photo
        </button>
      )}
      {!busy && photo.url && (
        <div
          className={cn(
            'designer-chrome absolute right-3 top-3 flex gap-2 transition-opacity focus-within:opacity-100 group-hover/photo:opacity-100',
            picked ? 'opacity-100' : 'opacity-0',
          )}
        >
          <FrameButton label="Change photo" onClick={() => input.current?.click()}>
            <Upload className="size-5" />
          </FrameButton>
          <Popover>
            <PopoverTrigger asChild>
              <FrameButton label="Move and zoom">
                <Move className="size-5" />
              </FrameButton>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <div className="flex flex-col gap-3 text-sm">
                <p className="text-xs text-muted-foreground">Or drag the photo inside its frame.</p>
                <Slider
                  label="Zoom"
                  min={1}
                  max={3}
                  step={0.05}
                  value={photo.zoom}
                  onChange={(zoom) => onChange({ ...photo, zoom })}
                />
                <Slider
                  label="Left – right"
                  min={0}
                  max={100}
                  step={1}
                  value={photo.x}
                  onChange={(x) => onChange({ ...photo, x })}
                />
                <Slider
                  label="Up – down"
                  min={0}
                  max={100}
                  step={1}
                  value={photo.y}
                  onChange={(y) => onChange({ ...photo, y })}
                />
              </div>
            </PopoverContent>
          </Popover>
          <FrameButton
            label="Remove photo"
            onClick={() => onChange({ url: '', x: 50, y: 50, zoom: 1 })}
          >
            <Trash2 className="size-5" />
          </FrameButton>
        </div>
      )}
    </div>
  )
}

function FrameButton({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-11 items-center justify-center rounded-full border border-white/60 bg-black/60 text-white shadow hover:bg-black/80"
      {...props}
    >
      {children}
    </button>
  )
}

function Slider({
  label,
  value,
  onChange,
  ...range
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="range"
        className="accent-primary"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        {...range}
      />
    </label>
  )
}
