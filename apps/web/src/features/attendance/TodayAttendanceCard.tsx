import { CheckCircle2, LogOut, MapPin, MapPinOff, RotateCw } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { useAttendanceMe, useCheckOut } from './api'
import { readPosition, useAutoState, useMarkNow } from './auto'

const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'

function span(from: string, to: string): string {
  const m = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000))
  return `${Math.floor(m / 60)} h ${m % 60} m`
}

/**
 * Today's attendance in one line, with the one thing to do next. The app
 * marks it by itself (see auto.ts); this says what happened and why not.
 */
export function TodayAttendanceCard() {
  const me = useAttendanceMe()
  const auto = useAutoState()
  const markNow = useMarkNow()
  const checkOut = useCheckOut()
  const d = me.data
  if (!d || d.mode === 'off') return null
  const t = d.today

  const doCheckOut = () =>
    void readPosition().then(
      (p) => checkOut.mutate({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => checkOut.mutate({}),
    )

  let tone: 'green' | 'amber' | 'muted' = 'muted'
  let icon = MapPin
  let title: string
  let sub: string | null = null
  let action: React.ReactNode = null

  if (d.day_off || d.on_leave) {
    title = d.on_leave ? 'On leave today' : `${d.day_off} — no attendance today`
  } else if (t?.check_in_at && t.check_out_at) {
    tone = 'green'
    icon = CheckCircle2
    title = `In ${clock(t.check_in_at)} · Out ${clock(t.check_out_at)}`
    sub = t.closed_by_system ? 'Nobody checked out; the day was closed for you.' : span(t.check_in_at, t.check_out_at)
  } else if (t?.check_in_at) {
    tone = 'green'
    icon = CheckCircle2
    title = `Marked ${t.status === 'late' ? `late (${t.late_minutes} min)` : 'present'} at ${clock(t.check_in_at)}`
    sub = [t.place_name, t.source === 'auto_login' ? 'marked when you opened the app' : null].filter(Boolean).join(' · ') || null
    action = (
      <Button size="sm" onClick={doCheckOut} disabled={checkOut.isPending}>
        <LogOut /> {checkOut.isPending ? 'Checking out…' : 'Check out'}
      </Button>
    )
  } else {
    tone = 'amber'
    const again = (
      <Button size="sm" onClick={() => void markNow(false)} disabled={auto.kind === 'checking'}>
        <RotateCw /> {auto.kind === 'checking' ? 'Checking…' : 'Try again'}
      </Button>
    )
    if (auto.kind === 'checking') {
      title = 'Checking your location…'
    } else if (auto.kind === 'outside') {
      icon = MapPinOff
      title = 'Not marked yet'
      sub = auto.message
      action = again
    } else if (auto.kind === 'denied') {
      icon = MapPinOff
      title = 'Allow location to be marked present'
      sub = 'Your browser is blocking it. Allow location for this site, then try again.'
      action = again
    } else if (auto.kind === 'unavailable') {
      icon = MapPinOff
      title = 'This device cannot share its location'
      sub = 'Open the app on your phone to be marked present.'
      action = again
    } else if (auto.kind === 'failed') {
      title = 'Not marked yet'
      sub = auto.message
      action = again
    } else {
      title = 'Not marked yet'
      sub = d.place_name ? `You're marked when you open the app at ${d.place_name}.` : "You're marked when you open the app at the studio."
      action = again
    }
  }

  return (
    <Card className={tone === 'amber' ? 'border-warning/60 bg-warning/5' : undefined}>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <IconTile icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attendance today</p>
          <p className="font-medium">{title}</p>
          {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </CardContent>
    </Card>
  )
}
