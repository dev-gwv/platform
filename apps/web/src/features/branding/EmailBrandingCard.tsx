import { useEffect, useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { useBranding, useSaveBranding } from '@/features/crm-sequences/api'

/**
 * How the studio's emails to its clients look (0202). Every studio's mail
 * already leads with its own name; white label drops "via IPC Studios" and
 * lets the studio choose the sender name, the reply-to and the footer.
 */
export function EmailBrandingCard({ readOnly }: { readOnly: boolean }) {
  const q = useBranding()
  const save = useSaveBranding()
  const [fromName, setFromName] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [footer, setFooter] = useState('')
  const b = q.data

  useEffect(() => {
    if (!b) return
    setFromName(b.from_name ?? '')
    setReplyTo(b.reply_to ?? '')
    setFooter(b.footer_line ?? '')
  }, [b])

  if (!b) return null
  const shownFrom = b.enabled ? fromName.trim() || b.studio_name : `${b.studio_name} via Studio AutoPilot`

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ from_name: fromName.trim() || null, reply_to: replyTo.trim() || null, footer_line: footer.trim() || null })
  }

  return (
    <Card className="mt-4">
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Emails to your clients</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Quotations, receipts, terms and follow-ups arrive from <span className="font-medium text-foreground">{shownFrom}</span>, with your
          logo on top, and replies come to you.
        </p>
        {!b.enabled ? (
          <p className="mt-3 flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" />
            Your own sender name, reply-to and footer, with no Studio AutoPilot on anything, comes with the higher plan.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="brand-from">Sender name</Label>
              <Input id="brand-from" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder={b.studio_name} disabled={readOnly} />
            </div>
            <div>
              <Label htmlFor="brand-reply">Replies go to</Label>
              <Input id="brand-reply" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="hello@yourstudio.in" disabled={readOnly} />
            </div>
            <div>
              <Label htmlFor="brand-footer">Footer line</Label>
              <Input id="brand-footer" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Asha Studio · Jaipur" disabled={readOnly} />
            </div>
            {!readOnly && (
              <div className="sm:col-span-3">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
