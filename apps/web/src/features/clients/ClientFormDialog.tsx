import { useState, type FormEvent } from 'react'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Plus, Pencil } from 'lucide-react'
import type { Client } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { useCreateClient, useUpdateClient } from './api'

interface Props {
  /** Present in edit mode; absent to create a new client. */
  client?: Client
  /** Edit mode renders as an icon button by default; pass a custom trigger to override. */
  trigger?: React.ReactNode
  /**
   * Controlled open state, for a page that opens the form itself — the setup
   * journey lands on "add a client" with the form already up. Omit both to
   * let the trigger manage it.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** No trigger button: the page opens it via `open`. */
  hideTrigger?: boolean
  /** Opened from setup: the save button is the one to pulse. */
  nudge?: boolean
  /** Called after a new client is saved (not after an edit). */
  onCreated?: (client: Client) => void
}

/** Create- or edit-client modal, depending on whether `client` is passed. */
export function ClientFormDialog({ client, trigger, open: openProp, onOpenChange, hideTrigger, onCreated, nudge }: Props) {
  const isEdit = !!client
  const create = useCreateClient()
  const update = useUpdateClient(client?.id ?? '')
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (o: boolean) => {
    if (openProp === undefined) setOpenState(o)
    onOpenChange?.(o)
  }
  const [name, setName] = useState(client?.name ?? '')
  const [phone, setPhone] = useState(client?.phone ?? '')
  const [alternatePhone, setAlternatePhone] = useState(client?.alternate_phone ?? '')
  const [email, setEmail] = useState(client?.email ?? '')
  const [city, setCity] = useState(client?.city ?? '')
  const [address, setAddress] = useState(client?.address ?? '')
  const [relation, setRelation] = useState(client?.relation ?? '')
  const [gstin, setGstin] = useState(client?.gstin ?? '')
  const [notes, setNotes] = useState(client?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `client:${client?.id ?? 'new'}` : null,
    { name, phone, alternatePhone, email, city, address, relation, gstin, notes },
    (v) => {
      setName(v.name)
      setPhone(v.phone)
      setAlternatePhone(v.alternatePhone)
      setEmail(v.email)
      setCity(v.city)
      setAddress(v.address)
      setRelation(v.relation)
      setGstin(v.gstin)
      setNotes(v.notes)
    },
  )

  function reset() {
    setName('')
    setPhone('')
    setAlternatePhone('')
    setEmail('')
    setCity('')
    setAddress('')
    setRelation('')
    setGstin('')
    setNotes('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    // Opened from inside another form (a new invoice), React would carry this
    // submit up to that form too, through the dialog's portal.
    e.stopPropagation()
    setError(null)
    let created: Client | undefined
    try {
      if (isEdit) {
        // Editing always resends every field explicitly — including as null —
        // so clearing a field in the form actually clears it on the server,
        // instead of a falsy value silently being left out of the patch.
        await update.mutateAsync({
          name: name.trim(),
          phone: phone.trim() || null,
          alternate_phone: alternatePhone.trim() || null,
          email: email.trim() || null,
          city: city.trim() || null,
          address: address.trim() || null,
          relation: relation.trim() || null,
          gstin: gstin.trim() || null,
          notes: notes.trim() || null,
        })
      } else {
        created = await create.mutateAsync({
          name: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(alternatePhone.trim() ? { alternate_phone: alternatePhone.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(relation.trim() ? { relation: relation.trim() } : {}),
          ...(gstin.trim() ? { gstin: gstin.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        })
      }
      draft.clear()
      setOpen(false)
      if (!isEdit) {
        reset()
        if (created) onCreated?.(created)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${isEdit ? 'update' : 'add'} the client.`)
    }
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          {trigger ?? (isEdit ? (
            <Button variant="outline" size="icon" aria-label={`Edit ${client.name}`}>
              <Pencil />
            </Button>
          ) : (
            <Button>
              <Plus /> New client
            </Button>
          ))}
        </DialogTrigger>
      )}
      <DialogContent
        title={isEdit ? 'Edit client' : 'New client'}
        description={isEdit ? "Update what's on file for them." : 'Add someone you work with.'}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus aria-invalid={name.trim() === '' ? true : undefined} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" aria-describedby="client-phone-hint" />
              <p id="client-phone-hint" className="text-[11px] text-muted-foreground">
                10-digit mobile — used to spot duplicate clients.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Alternate phone</Label>
              <Input value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@email.in" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Address</Label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              placeholder="Full address, for the invoice and paperwork"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Relation</Label>
              <Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Referral, Repeat, Vendor…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>GSTIN</Label>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="e.g. 27ABCDE1234F1Z5" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy} data-setup-nudge={nudge ? '' : undefined}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add client'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
