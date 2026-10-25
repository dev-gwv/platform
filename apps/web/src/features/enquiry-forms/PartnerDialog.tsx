import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { EnquiryPartner, EnquiryQuestion } from '@ipc/contracts'
import { PARTNER_KINDS, joinKinds, splitKinds } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useCreatePartner, usePartnerVendors, useUpdatePartner } from './api'
import { PartnerQuestions, questionsProblem } from './PartnerQuestions'

/**
 * Add or edit a partner (spec 3.7). What they are is a set of chips with
 * "Something else" for the studio's own word; picking one of the studio's
 * vendors fills in the name, mobile and kinds that are still empty.
 */
export function PartnerDialog({ partner, onClose }: { partner?: EnquiryPartner; onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreatePartner()
  const update = useUpdatePartner(partner?.id ?? '')
  const vendors = usePartnerVendors()
  const [name, setName] = useState(partner?.name ?? '')
  const [kinds, setKinds] = useState<string[]>(splitKinds(partner?.label))
  const [extra, setExtra] = useState<string[]>(splitKinds(partner?.label).filter((k) => !(PARTNER_KINDS as readonly string[]).includes(k)))
  const [other, setOther] = useState('')
  const [phone, setPhone] = useState((partner?.phone ?? '').replace(/\D/g, '').slice(-10))
  const [vendor, setVendor] = useState(partner?.party_id ?? '')
  const [notes, setNotes] = useState(partner?.notes ?? '')
  const [occasion, setOccasion] = useState(partner?.occasion ?? '')
  const [questions, setQuestions] = useState<EnquiryQuestion[]>(partner?.questions ?? [])
  const [error, setError] = useState<string | null>(null)
  const busy = create.isPending || update.isPending
  const list = vendors.data ?? []

  const tick = (k: string) => setKinds((x) => (x.includes(k) ? x.filter((v) => v !== k) : [...x, k]))
  const addOther = () => {
    const w = other.trim()
    if (!w) return
    if (!extra.includes(w) && !(PARTNER_KINDS as readonly string[]).includes(w)) setExtra((x) => [...x, w])
    setKinds((x) => (x.includes(w) ? x : [...x, w]))
    setOther('')
  }
  const pickVendor = (id: string) => {
    setVendor(id)
    const v = list.find((x) => x.id === id)
    if (!v) return
    if (!name.trim()) setName(v.name)
    if (!phone && v.phone) setPhone(v.phone.replace(/\D/g, '').slice(-10))
    if (!kinds.length && v.categories.length) {
      setKinds(v.categories)
      setExtra((x) => [...x, ...v.categories.filter((c) => !(PARTNER_KINDS as readonly string[]).includes(c) && !x.includes(c))])
    }
  }

  const save = () => {
    setError(null)
    if (name.trim().length < 2) return setError('Give the partner a name.')
    const problem = questionsProblem(questions)
    if (problem) return setError(problem)
    const body = {
      name: name.trim(),
      label: joinKinds(kinds),
      phone: phone.trim() || null,
      party_id: vendor || null,
      notes: notes.trim() || null,
      occasion: occasion.trim() || null,
      questions: questions.map((q) => ({ ...q, label: q.label.trim(), options: q.kind === 'choice' ? q.options : [] })),
    }
    const fail = (e: Error) => setError(e.message || 'We could not save the partner.')
    if (partner) {
      update.mutate(body, {
        onSuccess: () => {
          toast.success('Saved')
          onClose()
        },
        onError: fail,
      })
    } else {
      create.mutate(body, {
        onSuccess: (p) => {
          toast.success(`QR code made for ${p.name}`)
          onClose()
          void navigate({ to: '/follow-ups/partners/$id', params: { id: p.id } })
        },
        onError: fail,
      })
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={partner ? 'Edit partner' : 'Add a partner'} description="They get their own QR code for your enquiry form.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-name" className="font-semibold">
              Partner's name
            </Label>
            <Input
              id="p-name"
              autoFocus
              maxLength={80}
              placeholder="Riya Boutique"
              className={cn(!name.trim() && 'border-warning/60')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">What they are (tick all that apply)</legend>
            <div className="flex flex-wrap gap-1.5">
              {[...PARTNER_KINDS, ...extra].map((k) => {
                const on = kinds.includes(k)
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => tick(k)}
                    className={cn(
                      'inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm font-semibold',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-brand',
                    )}
                  >
                    {on && <Check className="size-4" aria-hidden />}
                    {k}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <Input
                aria-label="Something else"
                placeholder="Mehendi artist"
                maxLength={40}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addOther()
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addOther} disabled={!other.trim()}>
                <Plus /> Add
              </Button>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-phone" className="font-semibold">
              Their mobile
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">+91</span>
              <Input
                id="p-phone"
                type="tel"
                inputMode="tel"
                className="pl-12 tabular-nums"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">To send them their page on WhatsApp</p>
          </div>

          {list.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-vendor" className="font-semibold">
                Also one of your vendors?
              </Label>
              <Select id="p-vendor" value={vendor} onChange={(e) => pickVendor(e.target.value)}>
                <option value="">No</option>
                {list.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-notes" className="font-semibold">
              Notes
            </Label>
            <Textarea
              id="p-notes"
              rows={2}
              maxLength={1000}
              placeholder="What you agreed: where the QR is placed, any commission"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-occasion" className="font-semibold">
              What is this QR for? (optional)
            </Label>
            <Input
              id="p-occasion"
              maxLength={120}
              placeholder="e.g. Priya & Rahul's wedding, 14 Feb"
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Shown on the form, and on every lead this QR brings.</p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Your own questions on this QR</p>
            {partner && partner.enquiries > 0 && (
              <p className="text-xs text-muted-foreground">
                Change them freely. Leads that already came in keep the questions they were asked and their answers; only new
                enquiries get the new questions.
              </p>
            )}
            <PartnerQuestions value={questions} onChange={setQuestions} />
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : partner ? 'Save' : 'Add partner and make QR'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
