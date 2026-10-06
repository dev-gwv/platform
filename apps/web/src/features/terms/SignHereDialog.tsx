import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { SignaturePad } from '@/shared/ui/signature-pad'
import { useSignHere } from './api'
import { useTermsDocumentPayload } from './document'
import { TermsDocumentSheet } from './TermsDocumentSheet'

/**
 * "Sign now with Priya": the client is with you, so they read the terms and
 * sign on your phone or tablet. It records the same agreement and signature
 * as their own link would, marked "signed in person".
 */
export function SignHereDialog({
  documentId,
  clientName,
  onClose,
}: {
  documentId: string | null
  clientName: string | null
  onClose: () => void
}) {
  const doc = useTermsDocumentPayload(documentId)
  const sign = useSignHere()
  const [name, setName] = useState(clientName ?? '')
  const [signature, setSignature] = useState<string | null>(null)
  const first = clientName?.trim().split(/\s+/)[0] || 'The client'
  const ready = !!name.trim() && !!signature

  return (
    <Dialog open={!!documentId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl" title={`${first} signs here`} description="Hand them your phone or tablet. They read the terms, sign in the box and tap I agree.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!documentId || !signature || !name.trim()) return
            sign.mutate(
              { documentId, name: name.trim(), signature },
              {
                onSuccess: () => {
                  toast.success(`Signed. ${first} has agreed to the terms.`)
                  onClose()
                },
              },
            )
          }}
        >
          {doc.data ? (
            <div className="rounded-lg border border-border p-3">
              <TermsDocumentSheet doc={doc.data} bodyClassName="max-h-[35vh] overflow-auto" />
            </div>
          ) : (
            <Skeleton className="h-40" />
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sign-here-name">Name of the person signing</Label>
            <Input id="sign-here-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Signature</Label>
            <SignaturePad onChange={setSignature} label="Sign here with your finger" />
          </div>
          <Button type="submit" size="lg" disabled={!ready || sign.isPending}>
            <CheckCircle2 /> {sign.isPending ? 'Saving…' : 'I agree'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">The name, signature and time are kept as the record of agreement.</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
