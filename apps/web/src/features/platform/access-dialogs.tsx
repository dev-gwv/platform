import { useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import type { PlatformStudio } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { DateField, toIso } from '@/shared/ui/date-field'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useCreatePlatformStudio, useImportLegacyStudios, useSetAccessUntil } from './api'
import { legacyState, parseLegacyCsv, type LegacyParse } from './legacy'
import { endsOf } from './access-rows'

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/** Studio Access Manager's dialogs: give access to a date, create a studio, import the old app's list. */

/**
 * Give a studio access, as the old Studio Access board did: 30, 90 or 180
 * days or a year on from when its access ends now (or from today, once it
 * has ended), or to a date picked on the calendar. Each line says the date
 * it lands on before anything is saved.
 */
export function GiveAccessDialog({ studio, onClose }: { studio: PlatformStudio; onClose: () => void }) {
  const setUntil = useSetAccessUntil()
  const [picked, setPicked] = useState('')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = endsOf(studio)
  const base = end && new Date(end).getTime() > Date.now() ? new Date(end) : today
  const plus = (days: number) => {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return toIso(d)
  }
  const give = (until: string) => setUntil.mutate({ studioId: studio.id, until }, { onSuccess: onClose })
  const options = [
    { label: '30 days', until: plus(30) },
    { label: '90 days', until: plus(90) },
    { label: '180 days', until: plus(180) },
    { label: '1 year', until: plus(365) },
  ]
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        title={`Give ${studio.name} access`}
        description={end && new Date(end).getTime() > Date.now() ? `Access now ends on ${fmtDate(end)}.` : 'Access has ended; these count from today.'}
      >
        <div className="flex flex-col gap-2 text-sm">
          {options.map((o) => (
            <div key={o.label} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
              <span><span className="font-medium">+{o.label}</span> <span className="text-muted-foreground">→ until {fmtDate(o.until)}</span></span>
              <Button size="sm" disabled={setUntil.isPending} onClick={() => give(o.until)}>Give</Button>
            </div>
          ))}
          <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-2 ${picked ? 'border-success/50 bg-success/5' : 'border-warning/60 bg-warning/5'}`}>
            <span className="font-medium">Until a date</span>
            <div className="flex items-center gap-2">
              <DateField aria-label="Access until" value={picked} min={toIso(today)} onChange={(e) => setPicked(e.target.value)} />
              <Button size="sm" disabled={!picked || setUntil.isPending} onClick={() => give(picked)}>Set</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CreateStudioDialog() {
  const create = useCreatePlatformStudio()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [planKey, setPlanKey] = useState('')
  const [open, setOpen] = useState(false)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(open ? 'platform-studio:new' : null, { name, email, phone, planKey }, (v) => {
    setName(v.name)
    setEmail(v.email)
    setPhone(v.phone)
    setPlanKey(v.planKey)
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Create Studio Access</Button></DialogTrigger>
      <DialogContent
        title="Create studio"
        description="Creates the tenant and records the owner invite. The studio has no owner until that person registers against it."
      >
        <div className="mt-3 flex flex-col gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio name *" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Owner email *" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Owner phone (optional)" />
          <Input value={planKey} onChange={(e) => setPlanKey(e.target.value)} placeholder="Plan key (optional — grants trial)" />
          <Button disabled={create.isPending || !name.trim() || !email.trim()} onClick={() =>
              create.mutate(
                { name: name.trim(), owner_email: email.trim(), owner_phone: phone.trim() || undefined, plan_key: planKey.trim() || undefined },
                {
                  onSuccess: () => {
                    draft.clear()
                    setName('')
                    setEmail('')
                    setPhone('')
                    setPlanKey('')
                    setOpen(false)
                  },
                },
              )
            }
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Bring the old app's Studio Access export in: pick the file, check the counts, import. */
export function ImportOldAppButton() {
  const [open, setOpen] = useState(false)
  const [parsed, setParsed] = useState<LegacyParse | null>(null)
  const [bad, setBad] = useState(false)
  const imp = useImportLegacyStudios()
  const today = new Date().toISOString().slice(0, 10)
  const live = parsed?.rows.filter((r) => legacyState(r.expires_at, today) !== 'expired').length ?? 0
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setParsed(null); setBad(false) } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Upload className="mr-1 size-4" /> Import from old app</Button>
      </DialogTrigger>
      <DialogContent title="Import from the old app" description="On the old app open Studio Access, press Export CSV, then pick that file here.">
        <div className="flex flex-col gap-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            aria-label="The old app's Studio Access export"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const r = parseLegacyCsv(await f.text())
              setParsed(r)
              setBad(!r || r.rows.length === 0)
            }}
          />
          {bad && <p className="text-sm text-destructive">That file is not the old app's Studio Access export.</p>}
          {parsed && parsed.rows.length > 0 && (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <b>{parsed.rows.length}</b> studios · <b>{live}</b> still have access
              {parsed.skipped > 0 && <span className="text-muted-foreground"> · {parsed.skipped} lines skipped</span>}. Anyone already on the new
              app with the same email gets their remaining time now; the rest get it when they sign up.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!parsed || parsed.rows.length === 0 || imp.isPending}
              onClick={() => parsed && imp.mutate(parsed.rows, { onSuccess: () => { setOpen(false); setParsed(null) } })}
            >
              {imp.isPending ? 'Importing…' : `Import ${parsed?.rows.length ?? ''} studios`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
