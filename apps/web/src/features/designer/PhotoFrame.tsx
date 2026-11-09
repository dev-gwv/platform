import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { toast } from 'sonner'
import { Crop, ImagePlus, Loader2, Trash2, Upload } from 'lucide-react'
import type { DesignPhoto } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { PHOTO_DRAG_TYPE, useDesigner } from './context'
import { panPhoto, placePhoto } from './photo-math'

/**
 * A frame on the page that holds one photo (Quotation Designer), the way a
 * Canva frame works:
 * - drop a photo on it: from Uploads, or straight from the computer (a big
 *   camera file is made small first);
 * - tap it to pick it, then tap a photo in Uploads to put it there;
 * - press and drag moves the whole photo on the page (Movable around it);
 * - double-tap or Crop: the whole photo shows faded around the frame, and
 *   dragging moves the picture inside the frame, the wheel or the slider
 *   zooms it, Done or a tap outside ends it.
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

  const cropping = !!ctx && ctx.cropping === frameId
  const [natFor, setNat] = useState<{ url: string; w: number; h: number } | null>(null)
  // The size read belongs to one photo: a new photo is measured afresh.
  const nat = natFor && natFor.url === photo.url ? natFor : null
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const place =
    nat && size && size.w > 0
      ? placePhoto(size.w, size.h, nat.w, nat.h, photo.x, photo.y, photo.zoom)
      : null

  // In crop view, dragging moves the picture inside the frame and follows the hand.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!cropping || (e.target as HTMLElement).closest('button, input')) return
    e.stopPropagation()
    pan.current = { x: photo.x, y: photo.y, px: e.clientX, py: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const p = pan.current
    const el = box.current
    if (!p || !el || !place || !size || !nat) return
    const ratio = el.getBoundingClientRect().width / el.clientWidth || 1
    p.moved = true
    // Measured from where the drag started, so the picture stays under the hand.
    const start = placePhoto(size.w, size.h, nat!.w, nat!.h, p.x, p.y, photo.zoom)
    onChange({
      ...photo,
      ...panPhoto(
        start,
        size.w,
        size.h,
        p.x,
        p.y,
        (e.clientX - p.px) / ratio,
        (e.clientY - p.py) / ratio,
      ),
    })
  }
  function onPointerUp() {
    pan.current = null
  }
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    if (!cropping) return
    e.preventDefault()
    const zoom = Math.min(3, Math.max(1, Math.round((photo.zoom - e.deltaY / 500) * 100) / 100))
    if (zoom !== photo.zoom) onChange({ ...photo, zoom })
  }

  const imgAt = (faded: boolean) =>
    place ? (
      <img
        src={photo.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          left: place.left,
          top: place.top,
          width: place.width,
          height: place.height,
          opacity: faded ? 0.35 : 1,
        }}
      />
    ) : null

  const img = photo.url ? (
    place ? (
      imgAt(false)
    ) : (
      // Until its size is known (or on paper before it loads): the same look by CSS.
      <img
        src={photo.url}
        alt=""
        draggable={false}
        onLoad={(e) =>
          setNat({
            url: photo.url,
            w: e.currentTarget.naturalWidth,
            h: e.currentTarget.naturalHeight,
          })
        }
        className="pointer-events-none absolute inset-0 size-full select-none object-cover"
        style={{
          objectPosition: `${photo.x}% ${photo.y}%`,
          transform: `scale(${photo.zoom})`,
          transformOrigin: `${photo.x}% ${photo.y}%`,
        }}
      />
    )
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
      <div ref={box} className={cn('relative overflow-hidden', className)} style={style}>
        {img}
      </div>
    )
  }

  return (
    <div
      ref={box}
      data-photo-frame
      className={cn(
        'group/photo relative touch-none',
        cropping ? 'z-20 cursor-grab overflow-visible active:cursor-grabbing' : 'overflow-hidden',
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
      onWheel={onWheel}
    >
      {cropping && photo.url ? (
        <>
          {/* Canva's crop view: the whole photo faded around the frame, the frame's part clear. */}
          {imgAt(true)}
          <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 'inherit' }}>
            {imgAt(false)}
          </div>
          <div
            className="designer-chrome absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-white"
            style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={photo.zoom}
              onChange={(e) => onChange({ ...photo, zoom: Number(e.target.value) })}
              className="w-28 accent-violet-400"
              aria-label="Zoom the photo"
            />
          </div>
        </>
      ) : (
        img
      )}
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
      {!busy && photo.url && !cropping && (
        <div
          className={cn(
            'designer-chrome absolute right-3 top-3 flex gap-2 transition-opacity focus-within:opacity-100 group-hover/photo:opacity-100',
            picked ? 'opacity-100' : 'opacity-0',
          )}
        >
          <FrameButton label="Change photo" onClick={() => input.current?.click()}>
            <Upload className="size-5" />
          </FrameButton>
          <FrameButton label="Crop: move and zoom the photo inside" onClick={() => ctx?.setCropping(frameId)}>
            <Crop className="size-5" />
          </FrameButton>
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
