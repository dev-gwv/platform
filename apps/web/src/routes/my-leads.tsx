import { useMemo, useState } from 'react'
import { AlarmClock, Check, MessageCircle, Moon, Phone, Search, StickyNote } from 'lucide-react'
import type { MyLead, MyLeadDetail } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Dialog } from '@/shared/ui/dialog'
import { Input, Textarea } from '@/shared/ui/input'
import { SheetContent } from '@/shared/ui/sheet'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TONE_CHIP, toneOf } from '@/shared/ui/tones'
import { cn } from '@/shared/ui/cn'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { PartnerChip } from '@/features/crm/PartnerChip'
import { FOLLOW_UP_PRESETS, dueWords, presetAt, toLocalInput, type FollowUpPreset } from '@/features/crm/follow-ups'
import { useFollowUpDone } from '@/features/dashboard/api'
import { useAddMyFollowUp, useAddMyNote, useMoveMyFollowUp, useMyLead, useMyLeads } from '@/features/my-leads/api'
import { leadState, myLeadsFor, myLeadsSentence, type MyLeadsTab } from '@/features/my-leads/my-leads'

export function MyLeadsPage() {
  return (
    <AuthedPage module="dashboard">
      <MyLeads />
    </AuthedPage>
  )
}

const waLink = (phone: string) => {
  const d = phone.replace(/\D/g, '')
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`
}
const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const TABS: ReadonlyArray<{ key: MyLeadsTab; label: string }> = [
  { key: 'todo', label: 'To do' },
  { key: 'all', label: 'All open' },
  { key: 'closed', label: 'Booked & lost' },
]

/**
 * My leads (owner, 25 Oct: "when we assign the lead to any particular team
 * member, they should be able to see all the leads in their dashboard"):
 * every lead given to me, late follow-ups first, each with Call and WhatsApp
 * on the row and one tap into what was said and what is next.
 */
function MyLeads() {
  const q = useMyLeads()
  const [tab, setTab] = useState<MyLeadsTab>('todo')
  const [find, setFind] = useState('')
  const [open, setOpen] = useUrlParam('lead')
  const now = useMemo(() => new Date(), [q.dataUpdatedAt])
  const leads = q.data ?? []
  const shown = useMemo(() => myLeadsFor(tab, leads, find, now), [tab, leads, find, now])

  return (
    <>
      <PageHeader title="My leads" description={q.isPending ? undefined : myLeadsSentence(leads, now)} />
      {q.isPending ? (
        <SkeletonList rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : leads.length === 0 ? (
        <Card>
          <EmptyState title="No leads given to you yet" description="When the studio gives you a lead, it shows here and your bell tells you." />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'h-9 rounded-full border px-4 text-sm font-semibold',
                  tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-primary',
                )}
              >
                {t.label}
              </button>
            ))}
            <span className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, city or number" aria-label="Find a lead" className="pl-8" />
            </span>
          </div>
          {shown.length === 0 ? (
            <Card>
              <EmptyState title={tab === 'todo' ? 'Nothing to do right now' : 'Nothing here'} />
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {shown.map((l) => (
                  <LeadRow key={l.id} lead={l} now={now} onOpen={() => setOpen(l.id)} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      {open && <MyLeadSheet id={open} onClose={() => setOpen('')} />}
    </>
  )
}

function LeadRow({ lead: l, now, onOpen }: { lead: MyLead; now: Date; onOpen: () => void }) {
  const state = leadState(l, now)
  const facts = [l.event_type, l.event_date ? fmtDay(l.event_date) : null, l.city].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{l.name ?? 'Unnamed lead'}</span>
          {l.stage_name && (
            <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem] font-medium', TONE_CHIP[toneOf(l.stage_color)])}>{l.stage_name}</span>
          )}
          {l.partner_name && <PartnerChip name={l.partner_name} />}
        </span>
        {facts && <span className="mt-0.5 block truncate text-sm text-muted-foreground">{facts}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {state === 'none' ? (
            <span className="rounded-full border border-dashed border-warning/70 bg-warning/10 px-2 py-0.5 font-semibold text-warning">
              Set a follow-up
            </span>
          ) : l.follow_up_at && state !== 'closed' ? (
            <span className={cn('inline-flex items-center gap-1 font-semibold', state === 'late' ? 'text-destructive' : state === 'today' ? 'text-warning' : 'text-muted-foreground')}>
              <AlarmClock className="size-3.5" aria-hidden /> {l.next_subject ?? 'Follow up'} · {dueWords(l.follow_up_at, now)}
            </span>
          ) : null}
          {l.last_note && <span className="min-w-0 max-w-full truncate text-muted-foreground">“{l.last_note}”</span>}
        </span>
      </button>
      {l.phone && (
        <span className="flex shrink-0 gap-1.5">
          <Button size="sm" asChild>
            <a href={telLink(l.phone)}>
              <Phone /> Call
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={waLink(l.phone)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${l.name ?? ''}`}>
              <MessageCircle />
            </a>
          </Button>
        </span>
      )}
    </li>
  )
}

/** One of my leads: how to reach them, what they asked, what was said, what is next. */
function MyLeadSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useMyLead(id)
  const l = q.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={l?.name ?? 'Lead'} description="A lead given to you">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          {q.isPending ? (
            <SkeletonList rows={4} />
          ) : q.isError || !l ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <LeadBody lead={l} />
          )}
        </div>
      </SheetContent>
    </Dialog>
  )
}

function LeadBody({ lead: l }: { lead: MyLeadDetail }) {
  const now = new Date()
  const facts = [l.event_type, l.event_date ? fmtDay(l.event_date) : null, l.city].filter(Boolean).join(' · ')
  const open = l.activities.filter((a) => a.type === 'task' && !a.done_at)
  const history = l.activities.filter((a) => !(a.type === 'task' && !a.done_at))
  return (
    <>
      <div className="flex flex-col gap-1 pr-8 pt-1">
        <h2 className="text-xl font-semibold leading-tight">{l.name ?? 'Unnamed lead'}</h2>
        {l.partner_name && <PartnerChip name={l.partner_name} />}
        {l.enquiry_occasion && <p className="text-sm font-semibold text-primary">For {l.enquiry_occasion}</p>}
        {l.phone && <p className="text-lg font-semibold tabular-nums">{l.phone}</p>}
        {l.email && <p className="text-sm text-muted-foreground">{l.email}</p>}
        {facts && <p className="text-sm text-muted-foreground">{facts}</p>}
      </div>
      {l.phone && (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={telLink(l.phone)}>
              <Phone /> Call
            </a>
          </Button>
          <Button variant="outline" className="text-tone-green" asChild>
            <a href={waLink(l.phone)} target="_blank" rel="noreferrer">
              <MessageCircle /> WhatsApp
            </a>
          </Button>
        </div>
      )}

      <NextFollowUp leadId={l.id} open={open} now={now} />
      <AddNote leadId={l.id} />

      {(l.enquiry_answers?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What they told us</p>
          <dl className="flex flex-col gap-2">
            {l.enquiry_answers!.map((a, i) => (
              <div key={i}>
                <dt className="text-xs text-muted-foreground">{a.question}</dt>
                <dd className="text-sm font-medium">{a.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {l.notes && <p className="whitespace-pre-line rounded-xl bg-muted/60 px-3 py-2 text-sm">{l.notes}</p>}

      {history.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What happened</p>
          <ul className="flex flex-col gap-2">
            {history.map((a) => (
              <li key={a.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {a.type === 'task' ? `${a.subject ?? 'Follow-up'} · done` : a.type === 'note' ? 'Note' : (a.subject ?? a.type)}
                  {' · '}
                  {new Date(a.done_at ?? a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {a.actor_name ? ` · ${a.actor_name}` : ''}
                </p>
                {(a.body || a.outcome) && <p className="whitespace-pre-line">{a.body ?? a.outcome}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function NextFollowUp({ leadId, open, now }: { leadId: string; open: MyLeadDetail['activities']; now: Date }) {
  const add = useAddMyFollowUp()
  const move = useMoveMyFollowUp()
  const done = useFollowUpDone()
  const [at, setAt] = useState('')
  const [type, setType] = useState('Call')
  return (
    <section
      aria-label="Next follow-up"
      className={cn('flex flex-col gap-3 rounded-xl border p-3', open.length ? 'border-border' : 'border-dashed border-warning/70 bg-warning/5')}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <AlarmClock className="size-3.5" aria-hidden /> Next follow-up
      </p>
      {open.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{t.subject ?? 'Follow-up'}</span>
            {t.due_at && <span className="text-muted-foreground"> · {dueWords(t.due_at, now)}</span>}
            {t.body && <span className="block text-muted-foreground">{t.body}</span>}
          </span>
          <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ id: t.id, due_at: presetAt('tomorrow').toISOString() })}>
            <Moon /> Tomorrow
          </Button>
          <Button size="sm" className="bg-tone-green text-card hover:bg-tone-green/90" disabled={done.isPending} onClick={() => done.mutate(t.id)}>
            <Check /> Done
          </Button>
        </div>
      ))}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {['Call', 'WhatsApp', 'Meeting', 'Site visit'].map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={type === x}
              onClick={() => setType(x)}
              className={cn(
                'h-8 rounded-full border px-3 text-xs font-semibold',
                type === x ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:border-primary',
              )}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FOLLOW_UP_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setAt(toLocalInput(presetAt(p.key as FollowUpPreset)))}
              className="h-8 rounded-full border border-input bg-card px-3 text-xs font-semibold hover:border-primary"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            type="datetime-local"
            aria-label="When to follow up"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className={cn('h-10 flex-1', at ? 'border-success' : 'border-warning/70')}
          />
          <Button
            disabled={!at || add.isPending}
            onClick={() => add.mutate({ id: leadId, due_at: new Date(at).toISOString(), subject: type }, { onSuccess: () => setAt('') })}
          >
            Set
          </Button>
        </div>
      </div>
    </section>
  )
}

function AddNote({ leadId }: { leadId: string }) {
  const add = useAddMyNote()
  const [body, setBody] = useState('')
  return (
    <section className="flex flex-col gap-2">
      <Textarea
        rows={2}
        maxLength={4000}
        placeholder="What did they say?"
        aria-label="Write a note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <Button
        variant="outline"
        className="self-start"
        disabled={!body.trim() || add.isPending}
        onClick={() => add.mutate({ id: leadId, body: body.trim() }, { onSuccess: () => setBody('') })}
      >
        <StickyNote /> Save note
      </Button>
    </section>
  )
}
