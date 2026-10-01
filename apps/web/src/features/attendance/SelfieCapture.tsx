import { useEffect, useRef, useState } from 'react'
import { Camera, RotateCw } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { compressSelfie } from './selfie'

/**
 * Take a selfie for check-in. A file input with `capture="user"` opens the
 * phone's front camera straight away (the app's Permissions-Policy keeps
 * live camera access off, and this needs none). The photo is shown back with
 * Use this photo / Retake, then shrunk before it leaves the phone.
 */
export function SelfieCapture({
  open,
  onOpenChange,
  onUse,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUse: (file: File) => void
  busy?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setFile(null)
      setError(null)
    }
  }, [open])
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function picked(f: File | undefined) {
    if (!f) return
    setError(null)
    try {
      setFile(await compressSelfie(f))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Selfie to check in" description="Only you and the studio's managers see it.">
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          aria-label="Take a selfie"
          onChange={(e) => {
            void picked(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div className="flex flex-col items-center gap-3">
          {preview ? (
            <img src={preview} alt="Your selfie" className="max-h-72 rounded-lg" />
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-warning/60 bg-warning/5 text-sm font-medium"
            >
              <Camera className="size-8 text-warning" aria-hidden />
              Take a selfie
            </button>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {file && (
            <div className="flex w-full justify-end gap-2">
              <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
                <RotateCw /> Retake
              </Button>
              <Button onClick={() => onUse(file)} disabled={busy}>
                {busy ? 'Checking in…' : 'Use this photo'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
