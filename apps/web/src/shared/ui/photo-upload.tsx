import { useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { uploadFile } from '@/shared/api/client'
import { Avatar } from './avatar'
import { Button } from './button'
import { cn } from './cn'

const PHOTO_MAX_BYTES = 1024 * 1024

/**
 * A picture that is uploaded, not linked: a preview, one Upload button, and
 * Remove once there is one. The owner: "there is a section for adding the
 * profile URL, but the profile picture should be uploaded, under 1 MB."
 *
 * Public on purpose: a studio's logo has to load on a quotation a client
 * opens with no session. The caller saves the URL it gets back.
 */
export function PhotoUpload({
  src,
  name,
  shape = 'circle',
  onUploaded,
  onRemove,
  disabled,
  maxBytes = PHOTO_MAX_BYTES,
  className,
}: {
  src: string | null | undefined
  /** Initials when there is no picture yet (circle only). */
  name?: string | null | undefined
  shape?: 'circle' | 'square'
  onUploaded: (url: string) => void | Promise<void>
  onRemove?: (() => void) | undefined
  disabled?: boolean
  maxBytes?: number
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Pick a picture (JPG, PNG or WEBP).')
      return
    }
    if (file.size > maxBytes) {
      toast.error(`Keep it under ${Math.round(maxBytes / 1024 / 1024)} MB.`)
      return
    }
    setBusy(true)
    try {
      const stored = await uploadFile(file, { isPublic: true })
      await onUploaded(stored.url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not upload that picture.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {shape === 'circle' ? (
        <Avatar name={name} src={src} size="lg" className="size-16 text-lg" />
      ) : src ? (
        <img src={src} alt="" className="size-16 rounded-lg border border-border bg-card object-contain p-1" />
      ) : (
        <span className="flex size-16 items-center justify-center rounded-lg border border-dashed border-warning/60 bg-warning/10 text-warning">
          <Camera className="size-5" aria-hidden />
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={src ? 'outline' : 'default'} disabled={disabled || busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Camera />} {src ? 'Change photo' : 'Upload photo'}
          </Button>
          {src && onRemove && (
            <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={onRemove}>
              <X /> Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">JPG, PNG or WEBP · under {Math.round(maxBytes / 1024 / 1024)} MB</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled || busy}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
    </div>
  )
}
