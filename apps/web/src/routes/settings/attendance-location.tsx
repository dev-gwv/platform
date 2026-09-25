import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, MapPin } from 'lucide-react'
import { companyFence, setFenceRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { HowToUse } from '@/shared/ui/how-to-use'

export function AttendanceLocationPage() {
  return (
    <AuthedPage module="settings">
      <AttendanceLocation />
    </AuthedPage>
  )
}

/**
 * Lovable parity (/settings/attendance-location): geo-fence employees must be
 * inside to check in. Wired to the existing /hr/location endpoint.
 */
function AttendanceLocation() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const isOwner = session?.is_owner ?? false
  const fence = useQuery({
    queryKey: ['hr', 'location'],
    queryFn: () => callApi('/hr/location', { responseSchema: companyFence.nullable() }),
    enabled: !!session,
  })
  const save = useMutation({
    mutationFn: (body: {
      lat: number
      lng: number
      radius_m: number
      is_active: boolean
      expected_checkin_time: string | null
      late_grace_minutes: number
      missed_cutoff_time: string | null
    }) =>
      callApi('/hr/location', { method: 'PATCH', body: setFenceRequest.parse({ ...body, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }), responseSchema: companyFence }),
    onSuccess: () => {
      toast.success('Attendance location updated.')
      void qc.invalidateQueries({ queryKey: ['hr', 'location'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('100')
  const [active, setActive] = useState(true)
  // Empty means the studio has not declared a start of day, and nobody is
  // marked late. That is the default, and it is not the same as 00:00.
  const [expected, setExpected] = useState('')
  const [grace, setGrace] = useState('15')
  const [cutoff, setCutoff] = useState('')
  const [locating, setLocating] = useState(false)

  // The form as the server has it: what it is filled with, and what counts as
  // unchanged. With no fence yet, the defaults above.
  const serverFence = fence.data
    ? {
        lat: String(fence.data.lat),
        lng: String(fence.data.lng),
        radius: String(fence.data.radius_m),
        active: fence.data.is_active,
        // Postgres returns HH:MM:SS; <input type="time"> wants HH:MM. Null
        // stays empty.
        expected: fence.data.expected_checkin_time?.slice(0, 5) ?? '',
        grace: String(fence.data.late_grace_minutes),
        cutoff: fence.data.missed_cutoff_time?.slice(0, 5) ?? '',
      }
    : { lat: '', lng: '', radius: '100', active: true, expected: '', grace: '15', cutoff: '' }
  function fill(v: typeof serverFence) {
    setLat(v.lat)
    setLng(v.lng)
    setRadius(v.radius)
    setActive(v.active)
    setExpected(v.expected)
    setGrace(v.grace)
    setCutoff(v.cutoff)
  }

  useEffect(() => {
    if (fence.data) fill(serverFence)
    // `serverFence` is derived from `fence.data`.
  }, [fence.data])

  // What was typed survives a refresh or a closed tab until it is saved.
  // Only once the saved fence has loaded, and only real changes to it.
  const draft = useFormDraft(
    isOwner && fence.isSuccess ? 'attendance-location' : null,
    { lat, lng, radius, active, expected, grace, cutoff },
    fill,
    { isBlank: (v) => JSON.stringify(v) === JSON.stringify(serverFence) },
  )

  // Not a hook — it reads the browser geolocation once, on a click. The old
  // name made the hooks lint (rightly) treat it as one.
  async function captureCurrentLocation() {
    setLocating(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej),
      )
      setLat(pos.coords.latitude.toFixed(6))
      setLng(pos.coords.longitude.toFixed(6))
      toast.success('Current location applied.')
    } catch {
      toast.error('Unable to get your location.')
    } finally {
      setLocating(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const la = Number(lat)
    const ln = Number(lng)
    const r = Number(radius)
    if (!Number.isFinite(la) || la < -90 || la > 90) return toast.error('Latitude must be between -90 and 90.')
    if (!Number.isFinite(ln) || ln < -180 || ln > 180) return toast.error('Longitude must be between -180 and 180.')
    if (!Number.isFinite(r) || r < 20 || r > 5000) return toast.error('Radius must be between 20 and 5000 meters.')
    const g = Number(grace)
    if (!Number.isFinite(g) || g < 0 || g > 240) return toast.error('Grace must be between 0 and 240 minutes.')
    // Checked here as well as in the database so the studio is told which
    // field is wrong, rather than shown a failed save. Only when both are set:
    // leaving the working day undeclared is a valid choice.
    if (expected && cutoff && cutoff <= expected) {
      return toast.error('The missed check-in cutoff must be after the start time.')
    }
    save.mutate(
      {
        lat: la,
        lng: ln,
        radius_m: Math.round(r),
        is_active: active,
        expected_checkin_time: expected || null,
        late_grace_minutes: Math.round(g),
        missed_cutoff_time: cutoff || null,
      },
      { onSuccess: () => draft.clear() },
    )
  }

  return (
    <>
      <PageHeader title="Attendance Location" description="Configure the geo-fence employees must be inside to check in." />
      <SettingsTabs />
      <HowToUse
        title="Set attendance location"
        description="Set your studio or office location for team check-ins."
        steps={['Add your studio location.', 'Set allowed radius.', 'Save before asking team to check in.']}
      />
      {!isOwner ? (
        <Card className="mt-4">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Only the studio owner can manage the attendance location.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-4 max-w-xl">
          <CardContent className="p-4 sm:p-4">
            {!fence.data && !fence.isLoading && (
              <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                Employees cannot check in until attendance location is configured.
              </p>
            )}
            <form onSubmit={onSubmit} className="grid gap-4">
              <DraftRestoredBanner
                at={draft.restoredAt}
                onDismiss={draft.dismissRestored}
                onDiscard={() => {
                  draft.clear()
                  fill(serverFence)
                }}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Latitude</Label>
                  <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="e.g. 28.6139" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Longitude</Label>
                  <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="e.g. 77.2090" required />
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => void captureCurrentLocation()} disabled={locating} className="w-fit">
                {locating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MapPin className="mr-2 size-4" />}
                Use my current location
              </Button>
              <div className="flex flex-col gap-1.5">
                <Label>Radius (meters)</Label>
                <Input type="number" min={20} max={5000} value={radius} onChange={(e) => setRadius(e.target.value)} required />
                <p className="text-xs text-muted-foreground">Employees must be within this radius to check in.</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <Switch checked={active} onChange={setActive} label="Enforce geo-fence" description="When off, check-in still works but location is not validated." />
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <p className="font-medium">The working day</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Optional. Leave the start time empty and nobody is ever marked late — which is
                  how every studio behaves until someone fills it in. Set it, and a check-in after
                  the start plus the grace is recorded as late, with the attendance list showing
                  by how much.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="expected">Day starts at</Label>
                    <Input
                      id="expected"
                      type="time"
                      value={expected}
                      onChange={(e) => setExpected(e.target.value)}
                      disabled={!isOwner}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="grace">Grace (minutes)</Label>
                    <Input
                      id="grace"
                      type="number"
                      min={0}
                      max={240}
                      value={grace}
                      onChange={(e) => setGrace(e.target.value)}
                      disabled={!isOwner}
                    />
                    {/*
                      * Worth saying plainly, because it surprises people: the
                      * grace decides WHETHER someone is late, not from when the
                      * minutes count.
                      */}
                    <p className="text-xs text-muted-foreground">
                      Arriving within this is on time. Past it, the minutes are counted from the
                      start of the day, not from the end of the grace.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cutoff">Missed after</Label>
                    <Input
                      id="cutoff"
                      type="time"
                      value={cutoff}
                      onChange={(e) => setCutoff(e.target.value)}
                      disabled={!isOwner}
                    />
                    <p className="text-xs text-muted-foreground">
                      After this, a day with no check-in reads as missed rather than still pending.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save location'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  )
}
