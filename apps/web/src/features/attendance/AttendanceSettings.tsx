import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Link2, Loader2, MapPin } from 'lucide-react'
import { companyFence, setFenceRequest, type AttendanceSettings } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import { Input, Label } from '@/shared/ui/input'
import { Segmented } from '@/shared/ui/segmented'
import { Switch } from '@/shared/ui/switch'
import { TimeField } from '@/shared/ui/time-field'
import { useAttendanceSettings, useResolveLink, useSaveAttendanceSettings } from './api'
import { enabledSinceText } from './board'
import { PlacesAndRules } from './PlacesAndRules'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function useFence() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'location'],
    queryFn: () => callApi('/hr/location', { responseSchema: companyFence.nullable() }),
    enabled: !!session,
  })
}

/**
 * Settings → Attendance: off until the owner turns it on, then where the
 * studio is, its working hours, and whether a selfie is asked for. Who is
 * tracked where (positions, people, other places) is the rules card below.
 */
export function AttendanceSettingsPanel() {
  const { session } = useAuth()
  const isOwner = !!session?.is_owner
  const settings = useAttendanceSettings()
  if (!isOwner) {
    return (
      <Card className="mt-4">
        <CardContent className="p-4 text-sm text-muted-foreground">Only the studio owner changes attendance settings.</CardContent>
      </Card>
    )
  }
  if (!settings.data) return <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
  const s = settings.data
  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-4">
      <SwitchCard s={s} />
      <StudioPlaceCard s={s} />
      <WorkingHoursCard s={s} />
      <SelfieCard s={s} />
      <PlacesAndRules canEdit />
    </div>
  )
}

function SwitchCard({ s }: { s: AttendanceSettings }) {
  const save = useSaveAttendanceSettings()
  const confirm = useConfirm()
  if (!s.enabled) {
    return (
      <Card className="border-warning/50 bg-warning/5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Attendance is off.</span> Nobody is marked present or absent, and pay is never cut for
            attendance.
          </p>
          <Button
            className="ipc-nudge"
            disabled={save.isPending}
            onClick={() => save.mutate({ enabled: true }, { onSuccess: () => toast.success('Attendance is on from today.') })}
          >
            Turn on attendance
          </Button>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className="border-success/40 bg-success/5">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <Check className="size-4 text-success" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-medium">
          Attendance is on{s.enabled_at ? ` since ${enabledSinceText(s.enabled_at)}` : ''}.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={save.isPending}
          onClick={async () => {
            const yes = await confirm({
              title: 'Turn attendance off?',
              description: 'Nobody is marked or cut for attendance until you turn it on again.',
              confirmLabel: 'Turn off',
            })
            if (yes) save.mutate({ enabled: false })
          }}
        >
          Turn off
        </Button>
      </CardContent>
    </Card>
  )
}

const RADII = ['50', '100', '150', '300', '500'] as const

function StudioPlaceCard({ s }: { s: AttendanceSettings }) {
  const qc = useQueryClient()
  const fence = useFence()
  const resolve = useResolveLink()
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [radius, setRadius] = useState('150')
  const [note, setNote] = useState<{ text: string; rough: boolean } | null>(null)
  const [locating, setLocating] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')

  useEffect(() => {
    if (fence.data) {
      setPin({ lat: fence.data.lat, lng: fence.data.lng })
      setRadius(String(fence.data.radius_m))
    }
  }, [fence.data])

  const save = useMutation({
    mutationFn: () =>
      callApi('/hr/location', {
        method: 'PATCH',
        body: setFenceRequest.parse({
          lat: pin!.lat,
          lng: pin!.lng,
          radius_m: Math.round(Number(radius)),
          timezone: fence.data?.timezone ?? 'Asia/Kolkata',
          is_active: fence.data?.is_active ?? true,
          expected_checkin_time: s.day_start,
          late_grace_minutes: s.grace_min,
          missed_cutoff_time: fence.data?.missed_cutoff_time?.slice(0, 5) ?? null,
        }),
        responseSchema: companyFence,
      }),
    onSuccess: () => {
      toast.success('Studio place saved.')
      setNote(null)
      void qc.invalidateQueries({ queryKey: ['hr'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function readHere() {
    setLocating(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }),
      )
      const acc = Math.round(pos.coords.accuracy)
      setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setNote(
        acc > 100
          ? { text: `That fix is rough (±${acc} m). Try again outside, or paste a Google Maps link.`, rough: true }
          : { text: `Got it — accurate to ±${acc} m.`, rough: false },
      )
    } catch {
      toast.error('We could not read your location. Allow location for this site and try again.')
    } finally {
      setLocating(false)
    }
  }

  const r = Number(radius)
  const radiusOk = Number.isFinite(r) && r >= 20 && r <= 5000
  const changed =
    !!pin &&
    (!fence.data || pin.lat !== fence.data.lat || pin.lng !== fence.data.lng || Math.round(r) !== fence.data.radius_m)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-sm font-semibold">Where is the studio?</p>
        {pin ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <MapPin className="size-4 text-tone-blue" aria-hidden />
            Studio · {radiusOk ? `${Math.round(r)} m` : '—'}
            <a
              className="text-xs text-primary underline-offset-2 hover:underline"
              href={`https://www.google.com/maps?q=${pin.lat},${pin.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Maps
            </a>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No place set: your team can check in from anywhere.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void readHere()} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" /> : <MapPin />} Use my current location
          </Button>
          <Button type="button" variant="outline" onClick={() => setLinkOpen((o) => !o)}>
            <Link2 /> Paste a Google Maps link
          </Button>
        </div>
        {note && <p className={cn('text-xs', note.rough ? 'font-medium text-warning' : 'text-success')}>{note.text}</p>}
        {linkOpen && (
          <div className="flex gap-2">
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
              className={cn('min-w-0 flex-1', !link.trim() && 'border-warning/60 bg-warning/5')}
            />
            <Button
              type="button"
              disabled={!link.trim() || resolve.isPending}
              onClick={() =>
                resolve.mutate(link.trim(), {
                  onSuccess: (p) => {
                    setPin(p)
                    setNote({ text: 'Pin found from the link.', rough: false })
                    setLinkOpen(false)
                    setLink('')
                  },
                  onError: (e: Error) => toast.error(e.message),
                })
              }
            >
              Use this link
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label>How close counts as in?</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Radius"
              options={RADII.map((v) => ({ value: v, label: `${v} m` }))}
              value={(RADII as readonly string[]).includes(radius) ? (radius as (typeof RADII)[number]) : ('' as never)}
              onChange={setRadius}
            />
            <Input
              type="number"
              min={20}
              max={5000}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              aria-label="Custom radius in metres"
              className="w-24"
            />
          </div>
        </div>
        {changed && (
          <div>
            <Button disabled={!radiusOk || save.isPending} onClick={() => save.mutate()} className="ipc-nudge">
              {save.isPending ? 'Saving…' : 'Save place'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const GRACE = ['0', '10', '15', '30'] as const
const HALF = ['off', '4', '4.5', '5'] as const
const MARKS = ['0', '3', '4', '5'] as const

function WorkingHoursCard({ s }: { s: AttendanceSettings }) {
  const save = useSaveAttendanceSettings()
  const [start, setStart] = useState(s.day_start ?? '')
  const [grace, setGrace] = useState(String(s.grace_min))
  const [end, setEnd] = useState(s.day_end ?? '')
  const [half, setHalf] = useState(s.half_day_hours == null ? 'off' : String(s.half_day_hours))
  const [marks, setMarks] = useState(String(s.late_marks_per_half_day))
  const [off, setOff] = useState<number[]>(s.weekly_off)

  const badHours = !!start && !!end && end <= start
  const dirty =
    start !== (s.day_start ?? '') ||
    Number(grace) !== s.grace_min ||
    end !== (s.day_end ?? '') ||
    half !== (s.half_day_hours == null ? 'off' : String(s.half_day_hours)) ||
    Number(marks) !== s.late_marks_per_half_day ||
    [...off].sort().join() !== [...s.weekly_off].sort().join()

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <p className="text-sm font-semibold">Working hours</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="day-start">Day starts at</Label>
            <TimeField
              id="day-start"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={cn(!start && 'border-warning/60 bg-warning/5')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="day-end">Day ends at</Label>
            <TimeField id="day-end" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={badHours} />
            {badHours && <p className="text-xs text-destructive">The day has to end after it starts.</p>}
          </div>
        </div>
        <Row label="On time if in within">
          <Segmented label="Grace" options={GRACE.map((v) => ({ value: v, label: v === '0' ? 'No grace' : `${v} min` }))} value={grace as (typeof GRACE)[number]} onChange={setGrace} />
        </Row>
        <Row label="Half day if they work less than">
          <Segmented label="Half day" options={HALF.map((v) => ({ value: v, label: v === 'off' ? 'Off' : `${v.replace('.5', '½')} h` }))} value={half as (typeof HALF)[number]} onChange={setHalf} />
        </Row>
        <Row label="Weekly off">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = off.includes(i)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setOff((cur) => (on ? cur.filter((x) => x !== i) : [...cur, i]))}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent',
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>
          {off.length === 0 && <p className="mt-1 text-xs font-medium text-warning">No weekly off — every day is a working day.</p>}
        </Row>
        <Row label="Late marks">
          <Segmented label="Late marks" options={MARKS.map((v) => ({ value: v, label: v === '0' ? 'Off' : `${v} = ½ day` }))} value={marks as (typeof MARKS)[number]} onChange={setMarks} />
        </Row>
        {dirty && (
          <div>
            <Button
              className="ipc-nudge"
              disabled={badHours || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    day_start: start || null,
                    grace_min: Number(grace),
                    day_end: end || null,
                    half_day_hours: half === 'off' ? null : Number(half),
                    late_marks_per_half_day: Number(marks),
                    weekly_off: [...off].sort(),
                  },
                  { onSuccess: () => toast.success('Working hours saved.') },
                )
              }
            >
              {save.isPending ? 'Saving…' : 'Save working hours'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div>{children}</div>
    </div>
  )
}

function SelfieCard({ s }: { s: AttendanceSettings }) {
  const save = useSaveAttendanceSettings()
  return (
    <Card>
      <CardContent className="p-4">
        <Switch
          checked={s.selfie_required}
          onChange={(v) => save.mutate({ selfie_required: v }, { onSuccess: () => toast.success(v ? 'A selfie is asked for at check-in.' : 'No selfie at check-in.') })}
          label="Selfie at check-in"
          description="Only you and admins see it. Kept 60 days."
        />
      </CardContent>
    </Card>
  )
}
