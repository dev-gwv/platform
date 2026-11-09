import { useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Move, Trash2, Upload } from 'lucide-react'
import type { DesignPhoto } from '@ipc/contracts'
import { uploadFile } from '@/shared/api/client'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'
import { shrinkPhoto } from './shrink'

/**
 * A frame on the page that holds one photo (Quotation Designer): the studio
 * uploads its own, then moves it inside the frame and zooms it, the way a
 * Canva frame works. An empty frame is a soft tile with "Add your photo";
 * on paper and on the client's copy an empty frame is a quiet tint.
 */
export function PhotoFrame({
  photo,
  onChange,
  editable,
  accent,
  className,
  style,
}: {
  photo: DesignPhoto
  onChange: (p: DesignPhoto) => void
  editable: boolean
  accent: string
  className?: string | undefined
  style?: CSSProperties | undefined
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) return void toast.error('Pick a photo (JPG, PNG or WebP).')
    setBusy(true)
    try {
      const small = await shrinkPhoto(file)
      const stored = await uploadFile(small, { isPublic: true })
      onChange({ url: stored.url, x: 50, y: 50, zoom: 1 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The photo did not upload. Try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const img = photo.url ? (
    <img
      src={photo.url}
      alt=""
      draggable={false}
      className="absolute inset-0 size-full object-cover"
      style={{ objectPosition: `${photo.x}% ${photo.y}%`, transform: `scale(${photo.zoom})`, transformOrigin: `${photo.x}% ${photo.y}%` }}
    />
  ) : (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2"
      style={{ background: `linear-gradient(135deg, ${accent}22, ${accent}44)`, color: accent }}
    >
      {editable && (
        <>
          <ImagePlus className="size-10" aria-hidden />
          <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: 600 }}>Add your photo</span>
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
    <div className={cn('group/photo relative overflow-hidden', className)} style={style}>
      {img}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
          <Loader2 className="size-10 animate-spin" aria-label="Uploading" />
        </div>
      )}
      {!busy && !photo.url && (
        <button type="button" className="absolute inset-0 cursor-pointer" aria-label="Add your photo" onClick={() => input.current?.click()} />
      )}
      {!busy && photo.url && (
        <div className="designer-chrome absolute right-3 top-3 flex gap-2 opacity-0 transition-opacity group-hover/photo:opacity-100 focus-within:opacity-100">
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
                <Slider label="Left – right" min={0} max={100} step={1} value={photo.x} onChange={(x) => onChange({ ...photo, x })} />
                <Slider label="Up – down" min={0} max={100} step={1} value={photo.y} onChange={(y) => onChange({ ...photo, y })} />
                <Slider label="Zoom" min={1} max={3} step={0.05} value={photo.zoom} onChange={(zoom) => onChange({ ...photo, zoom })} />
              </div>
            </PopoverContent>
          </Popover>
          <FrameButton label="Remove photo" onClick={() => onChange({ url: '', x: 50, y: 50, zoom: 1 })}>
            <Trash2 className="size-5" />
          </FrameButton>
        </div>
      )}
    </div>
  )
}

function FrameButton({ label, children, ...props }: { label: string; children: React.ReactNode } & React.ComponentProps<'button'>) {
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

function Slider({ label, value, onChange, ...range }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input type="range" className="accent-primary" value={value} onChange={(e) => onChange(Number(e.target.value))} {...range} />
    </label>
  )
}
