import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Camera, CheckCircle2, LogIn, LogOut, MapPin, MapPinOff, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { uploadFile } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { useAttendanceMe, useCheckOut } from './api'
import { readPosition, useAutoState, useMarkNow } from './auto'
import { SelfieCapture } from './SelfieCapture'
import { dayClock, lateText } from './board'

const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'

function span(from: string, to: string): string {
  const m = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000))
  return `${Math.floor(m / 60)} h ${m % 60} m`
}

/**
 * Today's attendance in one line, with the one thing to do next. Hidden
 * while the studio has attendance off or does not track this person. The app
 * marks it by itself where it can (auto.ts); with a selfie asked for, or on a
 * shoot day, the person does.
 */
export function TodayAttendanceCard() {
  const me = useAttendanceMe()
  const auto = useAutoState()
  const markNow = useMarkNow()
  const checkOut = useCheckOut()
  const [selfie, setSelfie] = useState(false)
  const [sending, setSending] = useState(false)
  const d = me.data
  if (!d || !d.enabled || d.mode === 'off') return null
  const t = d.today

  const doCheckOut = () =>
    void readPosition().then(
      (p) => checkOut.mutate({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => checkOut.mutate({}),
    )
  const checkIn = () => (d.selfie_required ? setSelfie(true) : void markNow(false))
  const withSelfie = async (file: File) => {
    setSending(true)
    try {
      const stored = await uploadFile(file)
      await markNow(false, stored.id)
      setSelfie(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  let tone: 'green' | 'amber' | 'muted' = 'muted'
  let icon = MapPin
  let title: string
  let sub: string | null = null
  let action: React.ReactNode = null

  const checkInButton = (
    <Button size="sm" onClick={checkIn} disabled={auto.kind === 'checking'} className="ipc-nudge">
      {d.selfie_required ? <Camera /> : <LogIn />} {auto.kind === 'checking' ? 'Checking…' : 'Check in'}
    </Button>
  )

  if (d.day_off || (d.on_leave && !t?.check_in_at)) {
    title = d.on_leave ? 'On leave today' : `${d.day_off} — no attendance today`
  } else if (t?.source === 'shoot' && t.check_in_at) {
    tone = 'green'
    icon = CheckCircle2
    title = `Reached the shoot at ${clock(t.check_in_at)}`
    sub = t.status === 'late' ? `${lateText(t.late_minutes)} for the booking` : 'This is your attendance for today.'
  } else if (d.shoot_today && !t?.check_in_at) {
    tone = 'amber'
    title = `On a shoot today · ${d.shoot_today.name} ${clock(d.shoot_today.start_at)}–${clock(d.shoot_today.end_at)}`
    sub = "Tap I've reached at the venue."
    action = (
      <Button size="sm" variant="outline" asChild>
        <Link to="/shoots/my">My shoots</Link>
      </Button>
    )
  } else if (t?.check_in_at && t.check_out_at) {
    tone = 'green'
    icon = CheckCircle2
    title = `In ${clock(t.check_in_at)} · Out ${clock(t.check_out_at)} · ${span(t.check_in_at, t.check_out_at)}`
    sub = t.closed_by_system
      ? `Closed for you at ${clock(t.check_out_at)} — you didn't check out.`
      : t.status === 'half_day'
        ? 'Half day'
        : null
  } else if (t?.check_in_at) {
    tone = 'green'
    icon = CheckCircle2
    title = `In at ${clock(t.check_in_at)}${t.status === 'late' ? ` · ${lateText(t.late_minutes)}` : ''}`
    sub =
      [
        t.place_name ? `${t.place_name}${t.check_in_distance_m != null ? ` · ${t.check_in_distance_m} m` : ''}` : null,
        t.selfie_file_id ? 'selfie taken' : null,
        t.source === 'auto_login' ? 'marked when you opened the app' : null,
      ]
        .filter(Boolean)
        .join(' · ') || null
    action = (
      <Button size="sm" onClick={doCheckOut} disabled={checkOut.isPending}>
        <LogOut /> {checkOut.isPending ? 'Checking out…' : 'Check out'}
      </Button>
    )
  } else {
    tone = 'amber'
    title = `Not checked in yet${d.day_start ? ` · day starts ${dayClock(d.day_start)}` : ''}`
    action = checkInButton
    if (auto.kind === 'checking') {
      title = 'Checking your location…'
    } else if (auto.kind === 'outside' || auto.kind === 'failed') {
      icon = MapPinOff
      sub = auto.message
      action = (
        <Button size="sm" onClick={checkIn}>
          <RotateCw /> Try again
        </Button>
      )
    } else if (auto.kind === 'denied') {
      icon = MapPinOff
      sub = 'Your browser is blocking location. Allow it for this site, then try again.'
    } else if (auto.kind === 'unavailable') {
      icon = MapPinOff
      sub = 'This device cannot share its location. Open the app on your phone.'
    } else if (!d.selfie_required) {
      sub = d.place_name ? `You're marked when you open the app at ${d.place_name}.` : "You're marked when you open the app at the studio."
    }
  }

  return (
    <>
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
      {d.selfie_required && (
        <SelfieCapture open={selfie} onOpenChange={setSelfie} onUse={(f) => void withSelfie(f)} busy={sending || auto.kind === 'checking'} />
      )}
    </>
  )
}
