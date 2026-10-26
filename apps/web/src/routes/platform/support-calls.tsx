import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import qrcode from 'qrcode-generator'
import { Headphones, Plus, RefreshCw, Send, Unlink, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  normalizePhoneForWhatsApp,
  supportBotGroup,
  supportWhatsappOverview,
  type SupportCallMessageRow,
  type SupportWhatsappOverview,
  type SupportWhatsappSettings,
  z,
} from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/**
 * Platform -> Support calls (0280): who booked a support call and the WhatsApp
 * messages it sent. Platform admins only -- PlatformPage here, and the API's
 * requirePlatformAdmin again. Studios never see it.
 */
export function PlatformSupportCallsPage() {
  return (
    <PlatformPage>
      <SupportCalls />
    </PlatformPage>
  )
}

const KEY = ['platform', 'support-calls']
const ok = z.object({ ok: z.boolean() })

function SupportCalls() {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/platform/support-calls', { responseSchema: supportWhatsappOverview }),
    enabled: !!session,
    // Watch the link-up closely while a QR waits to be scanned.
    refetchInterval: (query) => (['qr', 'connecting'].includes(query.state.data?.bot.state ?? '') ? 4_000 : 30_000),
  })
  if (q.isLoading) return <SkeletonList rows={4} />
  if (q.isError || !q.data) return <ErrorState message="Couldn’t load support calls" onRetry={() => void q.refetch()} />
  return <Loaded data={q.data} />
}

function Loaded({ data }: { data: SupportWhatsappOverview }) {
  const qc = useQueryClient()
  const [s, setS] = useState<SupportWhatsappSettings>(data.settings)
  useEffect(() => {
    setS(data.settings)
  }, [data.settings])
  const changed = JSON.stringify(s) !== JSON.stringify(data.settings)
  const patch = (p: Partial<SupportWhatsappSettings>) => setS((v) => ({ ...v, ...p }))

  const save = useMutation({
    mutationFn: () => callApi('/platform/support-calls/settings', { method: 'PUT', body: s, responseSchema: ok }),
    onSuccess: () => {
      toast.success('Saved')
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
  const test = useMutation({
    mutationFn: (target: 'group' | 'team') => callApi('/platform/support-calls/test', { method: 'POST', body: { target }, responseSchema: ok }),
    onSuccess: () => {
      toast.success('Test queued. It shows under Messages in a few seconds.')
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: KEY }), 4_000)
    },
  })

  const summary = sentence(data, s)
  return (
    <>
      <PageHeader title="Support calls" description={summary} />
      <div className="flex flex-col gap-4">
        <CalendarCard calendar={data.calendar} />
        <ReadyCard ready={data.ready} />
        <BotCard data={data} s={s} patch={patch} onTest={() => test.mutate('group')} testing={test.isPending} />
        <OfficialCard s={s} patch={patch} ready={data.ready.official_api} onTest={() => test.mutate('team')} testing={test.isPending} />
        <LimitsCard s={s} patch={patch} />
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-2 bg-background/90 px-1 py-2 backdrop-blur">
          <Button disabled={!changed || save.isPending} onClick={() => save.mutate()} className={cn(changed && 'ipc-nudge')}>
            Save
          </Button>
          {changed && <span className="text-xs text-warning">Not saved yet</span>}
        </div>
        <BookingsCard bookings={data.bookings} />
        <MessagesCard messages={data.messages} />
      </div>
    </>
  )
}

function sentence(d: SupportWhatsappOverview, s: SupportWhatsappSettings): string {
  const group = s.bot_on && s.group_jid && d.bot.state === 'open' ? `posting in ${s.group_name ?? 'the group'}` : 'the group bot is not posting'
  const official = s.official_on ? 'confirmations and reminders on' : 'official messages off'
  const from = d.calendar.address ? (d.calendar.error ? 'the calendar could not be read' : `${d.calendar.upcoming} calls ahead on the calendar`) : 'no calendar connected yet'
  return `${from[0]!.toUpperCase()}${from.slice(1)}; ${group}; ${official}.`
}

/** Where bookings come from: the support calls calendar's private address (0283). */
function CalendarCard({ calendar }: { calendar: SupportWhatsappOverview['calendar'] }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(!calendar.address)
  const save = useMutation({
    mutationFn: (next: string | null) =>
      callApi('/platform/support-calls/calendar', { method: 'PUT', body: { url: next }, responseSchema: z.object({ ok: z.boolean(), error: z.string().nullable() }) }),
    onSuccess: (r, next) => {
      if (r.error) toast.error(r.error)
      else toast.success(next ? 'Connected. Calls already on it were noted quietly; new ones will post.' : 'Disconnected.')
      setUrl('')
      setEditing(!next)
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
  const check = useMutation({
    mutationFn: () =>
      callApi('/platform/support-calls/calendar/check', {
        method: 'POST',
        responseSchema: z.object({ ok: z.boolean(), error: z.string().nullable(), booked: z.number(), moved: z.number(), cancelled: z.number() }),
      }),
    onSuccess: (r) => {
      if (r.error) toast.error(r.error)
      else toast.success(r.booked + r.moved + r.cancelled ? `${r.booked} new · ${r.moved} moved · ${r.cancelled} cancelled` : 'Nothing new on the calendar.')
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
  const checked = calendar.checked_at ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(calendar.checked_at)) : null
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Support calls calendar</h2>
          {calendar.address && <StatusBadge tone={calendar.error ? 'danger' : 'success'}>{calendar.error ? 'Not reading' : 'Connected'}</StatusBadge>}
          {calendar.address && !calendar.error && (
            <span className="text-xs text-muted-foreground">
              {calendar.upcoming} calls ahead{checked ? ` · read ${checked}` : ''}
            </span>
          )}
        </div>
        {calendar.error && <p className="text-sm text-destructive">{calendar.error}</p>}
        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Input
                className={cn('min-w-0 flex-1 font-mono text-xs', !url.trim() && 'border-warning bg-warning/5')}
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button disabled={!url.trim() || save.isPending} onClick={() => save.mutate(url.trim())}>
                Connect
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Google Calendar → the support calls calendar’s <b>Settings</b> → <b>Secret address in iCal format</b>. Use a calendar that holds only support calls.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md border border-success/60 px-2 py-1 font-mono text-xs">{calendar.address}</span>
            <Button size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
              <RefreshCw /> Check now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={save.isPending} onClick={() => save.mutate(null)}>
              Disconnect
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ReadyCard({ ready }: { ready: SupportWhatsappOverview['ready'] }) {
  const row = (ok: boolean, label: string, fix: string) => (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge tone={ok ? 'success' : 'warning'}>{ok ? 'Ready' : 'Missing'}</StatusBadge>
      <span>{label}</span>
      {!ok && <span className="text-xs text-muted-foreground">{fix}</span>}
    </li>
  )
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <h2 className="font-semibold">On the server</h2>
        <ul className="flex flex-col gap-1.5">
          {row(ready.official_api, 'Official WhatsApp number', 'Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.')}
          {row(ready.bot_secret, 'Group bot', 'Set WA_BOT_SECRET in .env, then deploy.')}
        </ul>
      </CardContent>
    </Card>
  )
}

const BOT_WORDS: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string }> = {
  open: { tone: 'success', text: 'Linked' },
  qr: { tone: 'warning', text: 'Waiting for the phone' },
  connecting: { tone: 'neutral', text: 'Connecting…' },
  logged_out: { tone: 'warning', text: 'Unlinked' },
  unreachable: { tone: 'danger', text: 'Not running' },
  off: { tone: 'neutral', text: 'Not set up' },
}

function BotCard({
  data,
  s,
  patch,
  onTest,
  testing,
}: {
  data: SupportWhatsappOverview
  s: SupportWhatsappSettings
  patch: (p: Partial<SupportWhatsappSettings>) => void
  onTest: () => void
  testing: boolean
}) {
  const qc = useQueryClient()
  const bot = data.bot
  const word = BOT_WORDS[bot.state] ?? BOT_WORDS.off!
  const [showGroups, setShowGroups] = useState(false)
  const groups = useQuery({
    queryKey: [...KEY, 'groups'],
    queryFn: () => callApi('/platform/support-calls/groups', { responseSchema: supportBotGroup.array() }),
    enabled: showGroups && bot.state === 'open',
  })
  const sample = useMutation({
    mutationFn: () => callApi('/platform/support-calls/sample', { method: 'POST', responseSchema: ok }),
    onSuccess: () => {
      toast.success('Sample booking made. Its group post shows under Messages in a few seconds.')
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: KEY }), 5_000)
    },
  })
  const unlink = useMutation({
    mutationFn: () => callApi('/platform/support-calls/bot/logout', { method: 'POST', responseSchema: ok }),
    onSuccess: () => {
      toast.success('Unlinked. A new QR appears in a moment.')
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Support group bot</h2>
          <StatusBadge tone={word.tone}>{word.text}</StatusBadge>
          {bot.state === 'open' && (
            <span className="text-xs text-muted-foreground">
              {bot.me ? `+${bot.me.slice(0, -4).replace(/\d/g, '•')}${bot.me.slice(-4)} · ` : ''}
              {bot.sent_last_hour} in the last hour · {bot.sent_today} today
            </span>
          )}
        </div>

        {bot.state === 'qr' && bot.qr && (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <Qr value={bot.qr} />
            <p className="max-w-sm text-sm">
              On the <b>spare phone</b>: WhatsApp → Settings → <b>Linked devices</b> → <b>Link a device</b>, and scan this. Never your business number.
            </p>
          </div>
        )}

        {bot.state === 'open' && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Posts in</span>
              <span className={cn('rounded-md border px-2 py-1', s.group_jid ? 'border-success/60' : 'border-dashed border-warning bg-warning/5 text-warning')}>
                {s.group_name ?? 'No group picked yet'}
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowGroups((v) => !v)}>
                {showGroups ? 'Close' : s.group_jid ? 'Change group' : 'Pick the group'}
              </Button>
            </div>
            {showGroups && (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                {groups.isLoading && <SkeletonList rows={2} />}
                {groups.data?.length === 0 && <p className="p-2 text-sm text-muted-foreground">The bot is in no groups yet. Add the spare number to the support group first.</p>}
                {groups.data?.map((g) => (
                  <button
                    key={g.jid}
                    type="button"
                    onClick={() => {
                      patch({ group_jid: g.jid, group_name: g.name })
                      setShowGroups(false)
                    }}
                    className={cn('flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', g.jid === s.group_jid && 'bg-success/10')}
                  >
                    <span>{g.name || 'Unnamed group'}</span>
                    <span className="text-xs text-muted-foreground">{g.size} people</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <Switch
          checked={s.bot_on}
          onChange={(v) => patch({ bot_on: v })}
          label="Post support calls in the group"
          description="Off, or when the bot cannot post, the team numbers below get the official message instead."
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={bot.state !== 'open' || !data.settings.group_jid || testing} onClick={onTest}>
            <Send /> Send a test to the group
          </Button>
          <Button
            size="sm"
            variant="outline"
            title="A made-up booking through the whole path. Nobody is messaged personally."
            disabled={bot.state !== 'open' || !data.settings.group_jid || !data.settings.bot_on || sample.isPending}
            onClick={() => sample.mutate()}
          >
            <Headphones /> Try a sample booking
          </Button>
          {(bot.state === 'open' || bot.state === 'qr') && (
            <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              <Unlink /> Unlink the phone
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void qc.invalidateQueries({ queryKey: KEY })}>
            <RefreshCw /> Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Qr({ value }: { value: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'L')
    qr.addData(value)
    qr.make()
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  }, [value])
  // The generator's own SVG of the bot's QR: our data, not anyone's input.
  return <span role="img" aria-label="QR code to link the spare phone" className="inline-block size-48 bg-white" dangerouslySetInnerHTML={{ __html: svg }} />
}

function OfficialCard({
  s,
  patch,
  ready,
  onTest,
  testing,
}: {
  s: SupportWhatsappSettings
  patch: (p: Partial<SupportWhatsappSettings>) => void
  ready: boolean
  onTest: () => void
  testing: boolean
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const n = normalizePhoneForWhatsApp(draft)
    if (!/^\d{10,15}$/.test(n)) return toast.error('A number is 10 digits, or with the country code.')
    if (!s.team_numbers.includes(n)) patch({ team_numbers: [...s.team_numbers, n].slice(0, 10) })
    setDraft('')
  }
  const tpl = (key: 'tpl_booked' | 'tpl_reminder' | 'tpl_cancelled' | 'tpl_team', label: string) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input className="font-mono text-xs" value={s[key]} onChange={(e) => patch({ [key]: e.target.value.trim() })} />
    </label>
  )
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold">Official messages</h2>
        <Switch
          checked={s.official_on}
          onChange={(v) => patch({ official_on: v })}
          disabled={!ready}
          label="Send confirmations, reminders and team alerts"
          description="Only to people who ticked WhatsApp when booking, at most 4 messages a booking. Templates must be approved in Meta first."
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm">Support team numbers (when the group cannot be used)</span>
          <div className="flex flex-wrap gap-2">
            {s.team_numbers.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 rounded-full border border-success/50 bg-success/10 px-2 py-0.5 text-xs">
                +{n}
                <button type="button" aria-label={`Remove ${n}`} className="hover:text-destructive" onClick={() => patch({ team_numbers: s.team_numbers.filter((x) => x !== n) })}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex max-w-sm gap-2">
            <Input
              placeholder="98765 43210"
              inputMode="tel"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              className={cn(!s.team_numbers.length && 'border-warning bg-warning/5')}
            />
            <Button variant="outline" onClick={add} disabled={!draft.trim()}>
              <Plus /> Add
            </Button>
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Template names in Meta</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {tpl('tpl_booked', 'Booked or moved (to them)')}
            {tpl('tpl_reminder', 'Reminder an hour before')}
            {tpl('tpl_cancelled', 'Cancelled')}
            {tpl('tpl_team', 'Team alert')}
          </div>
        </details>
        <div>
          <Button size="sm" variant="outline" disabled={!ready || !s.official_on || !s.team_numbers.length || testing} onClick={onTest}>
            <Send /> Send a test to the first number
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LimitsCard({ s, patch }: { s: SupportWhatsappSettings; patch: (p: Partial<SupportWhatsappSettings>) => void }) {
  const num = (key: 'hourly_cap' | 'daily_cap', label: string, max: number) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <Input
        className="w-24"
        inputMode="numeric"
        value={String(s[key])}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''))
          patch({ [key]: Math.max(1, Math.min(max, n || 1)) })
        }}
      />
    </label>
  )
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold">Limits</h2>
        <div className="flex flex-wrap gap-4">
          {num('hourly_cap', 'Group posts an hour', 60)}
          {num('daily_cap', 'Group posts a day', 300)}
        </div>
        <Switch checked={s.daily_summary} onChange={(v) => patch({ daily_summary: v })} label="Post the day's calls in the group at 9 am" description="Only on days with calls." />
      </CardContent>
    </Card>
  )
}

const BOOKING_TONE = { booked: 'success', rescheduled: 'info', cancelled: 'neutral' } as const
const istTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

function BookingsCard({ bookings }: { bookings: SupportWhatsappOverview['bookings'] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Headphones className="size-4 text-tone-teal" /> Latest bookings
        </h2>
        {bookings.length === 0 && <p className="text-sm text-muted-foreground">None yet. They appear here as the booking app sends them.</p>}
        <ul className="flex flex-col divide-y divide-border">
          {bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <StatusBadge tone={BOOKING_TONE[b.status]}>{b.status}</StatusBadge>
              <span className="font-medium">{b.name || 'Someone'}</span>
              {b.studio_name && <span className="text-muted-foreground">· {b.studio_name}</span>}
              <span className="text-muted-foreground">· {istTime(b.starts_at)}</span>
              {!b.whatsapp_ok && <span className="text-xs text-muted-foreground">· no WhatsApp asked</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

const MESSAGE_TONE: Record<SupportCallMessageRow['status'], 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  sent: 'success',
  queued: 'info',
  sending: 'info',
  failed: 'danger',
  skipped: 'neutral',
}
const WHO = { booker: 'To them', team: 'To the team', group: 'Group' } as const

function MessagesCard({ messages }: { messages: SupportCallMessageRow[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <h2 className="font-semibold">Messages</h2>
        {messages.length === 0 && <p className="text-sm text-muted-foreground">Nothing sent yet.</p>}
        <ul className="flex flex-col divide-y divide-border">
          {messages.map((m) => (
            <li key={m.id} className="flex flex-col gap-0.5 py-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={MESSAGE_TONE[m.status]}>{m.status === 'queued' && Date.parse(m.send_after) > Date.now() ? `due ${istTime(m.send_after)}` : m.status}</StatusBadge>
                <span className="text-muted-foreground">{WHO[m.audience]}</span>
                {m.to && <span className="text-muted-foreground">{m.to}</span>}
                <span>{m.what}</span>
                {m.sent_at && <span className="text-xs text-muted-foreground">· {istTime(m.sent_at)}</span>}
              </div>
              {m.last_error && <span className={cn('text-xs', m.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{m.last_error}</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
