import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, FileText } from 'lucide-react'
import { issuedLink, type IssueQuotationRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'

/**
 * Turn the project's client-visible deliverables into a quotation the client
 * can open and accept.
 *
 * The link is the product here, not an email: a studio sends it on WhatsApp as
 * often as by mail, so the dialog's job is to hand it over cleanly.
 */
export function QuotationLinkDialog({
  projectId,
  open: openProp,
  onOpenChange,
}: {
  projectId: string
  /** Opened from elsewhere (a menu) instead of its own button. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openSelf, setOpenSelf] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openSelf
  const setOpen = (o: boolean) => (controlled ? onOpenChange?.(o) : setOpenSelf(o))
  const [notes, setNotes] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const issue = useMutation({
    mutationFn: (input: IssueQuotationRequest) =>
      callApi('/documents/quotations', {
        method: 'POST',
        body: input,
        responseSchema: issuedLink,
      }),
    onSuccess: (r) => {
      setLink(r.link)
      toast.success('Quotation ready')
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setLink(null)
          setCopied(false)
        }
      }}
    >
      {!controlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <FileText /> Quotation
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        title="Send a quotation"
        description="The client sees the deliverables marked for the quotation, and the totals as they stand now."
      >
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Send them this link. It opens without an account, and the prices on it stay as they
              are today even if the project changes.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(link)
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Note for the client</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Valid for 30 days. 50% advance to confirm the date."
              />
            </div>
            <Button
              onClick={() => issue.mutate({ project_id: projectId, notes: notes.trim() || null })}
              disabled={issue.isPending}
            >
              {issue.isPending ? 'Preparing…' : 'Create the link'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
