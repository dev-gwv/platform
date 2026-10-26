import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImageUp, PenLine, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { SignaturePad } from '@/shared/ui/signature-pad'
import { cn } from '@/shared/ui/cn'

export type SignatureValue = {
  signatory_name: string | null
  signatory_title: string | null
  signature_image: string | null
}

/** A picked image, shrunk to at most 600 × 200 and kept as a PNG data URL (a few KB). */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = bad
      i.src = url
    })
    const scale = Math.min(1, 600 / img.width, 200 / img.height)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * scale))
    c.height = Math.max(1, Math.round(img.height * scale))
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Who signs the invoice, changed from the invoice itself (owner, 26 Oct: it
 * could only be changed by asking us). A name, a title and a signature --
 * drawn with a finger or uploaded -- saved for every invoice the studio
 * prints, the old ones too.
 */
export function SignatureDialog({ value, onClose }: { value: SignatureValue; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(value.signatory_name ?? '')
  const [title, setTitle] = useState(value.signatory_title ?? 'Authorised signatory')
  const [image, setImage] = useState<string | null>(value.signature_image)
  const [mode, setMode] = useState<'keep' | 'draw'>(value.signature_image ? 'keep' : 'draw')
  const save = useMutation({
    mutationFn: () =>
      callApi('/billing/signature', {
        method: 'PUT',
        body: { signatory_name: name.trim() || null, signatory_title: title.trim() || null, signature_image: image },
        responseSchema: z.object({ ok: z.boolean() }),
      }),
    onSuccess: () => {
      toast.success('Signature saved. Every invoice shows it now.')
      void qc.invalidateQueries({ queryKey: ['billing'] })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message || 'We could not save the signature.'),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Signature on your invoices" description="Shown at the foot of every invoice, the ones already made too.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sig-name">Name</Label>
              <Input id="sig-name" maxLength={80} placeholder="e.g. Asha Rao" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sig-title">Title</Label>
              <Input id="sig-title" maxLength={60} placeholder="Authorised signatory" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Signature</p>
            {mode === 'keep' && image ? (
              <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/5 p-3">
                <img src={image} alt="Signature" className="h-16 w-auto max-w-[240px] rounded bg-white object-contain" />
                <span className="ml-auto flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setImage(null); setMode('draw') }}>
                    <PenLine /> Sign again
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="hover:text-destructive" onClick={() => { setImage(null); setMode('draw') }}>
                    <Trash2 /> Remove
                  </Button>
                </span>
              </div>
            ) : (
              <>
                <SignaturePad onChange={setImage} label="Sign here with your finger or mouse" />
                <label
                  className={cn(
                    'inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-sm font-semibold hover:border-primary',
                  )}
                >
                  <ImageUp className="size-4" aria-hidden /> Or upload a photo of it
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 5 * 1024 * 1024) return toast.error('Keep it under 5 MB.')
                      try {
                        setImage(await shrink(f))
                        setMode('keep')
                      } catch {
                        toast.error('We could not read that image.')
                      }
                    }}
                  />
                </label>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save signature'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
