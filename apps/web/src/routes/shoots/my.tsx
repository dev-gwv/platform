import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, CalendarPlus, HardDrive, MapPin, Users } from 'lucide-react'
import { myShoot, type DataRecord, type MyShoot, type TeamSlot } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { PageHeader } from '@/shared/layout/page-header'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { HowToUse } from '@/shared/ui/how-to-use'
import { humanize } from '@/shared/ui/format'
import { useSlots } from '@/features/allocation/api'
import { Button } from '@/shared/ui/button'
import { downloadIcs } from '@/features/booking/share'
import { mapHref } from '@/features/shoots/map-link'
import { useMyData } from '@/features/data/api'
import { HandoverDialog } from '@/features/data/HandoverDialog'
import { STAGE_LABEL, STAGE_TONE, optedOut } from '@/features/data/stage'

/** A booking whose shoot is over, owes data, and has not been handed over. */
const owesData = (sl: TeamSlot, rec: DataRecord | undefined, now: string) =>
  sl.status === 'booked' && sl.end_at < now && !optedOut(sl) && (!rec || rec.data_status === 'with_shooter')

const list = myShoot.array()

const TONE = { planned: 'info', confirmed: 'warning', completed: 'success', cancelled: 'danger' } as const

const dayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' })

function useMyShoots() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['shoots', 'my'],
    queryFn: () => callApi('/shoots/my', { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

/**
 * The shoots I am booked on. Read from the same booking slots the allocation
 * page writes, so what a manager booked is exactly what the photographer sees.
 */
export function MyShootsPage() {
  return <MyShoots />
}

function MyShoots() {
  const { session } = useAuth()
  const shoots = useMyShoots()
  const slots = useSlots()
  const mine = useMyData()
  const records = useMemo(() => new Map((mine.data ?? []).filter((r) => r.slot_id).map((r) => [r.slot_id!, r])), [mine.data])
  const [handing, setHanding] = useState<{ slot: TeamSlot; shootName: string } | null>(null)

  // My own slots, keyed by shoot, so each card can say when I am needed.
  const mySlots = useMemo(() => {
    const map = new Map<string, TeamSlot[]>()
    for (const s of slots.data ?? []) {
      if (s.user_id !== session?.user_id || !s.shoot_id || s.status === 'cancelled') continue
      map.set(s.shoot_id, [...(map.get(s.shoot_id) ?? []), s].sort((a, b) => a.start_at.localeCompare(b.start_at)))
    }
    return map
  }, [slots.data, session?.user_id])

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = (shoots.data ?? []).filter((s) => !s.shoot_date || s.shoot_date >= today)
  const past = (shoots.data ?? []).filter((s) => s.shoot_date && s.shoot_date < today)
  const now = new Date().toISOString()
  const owed = [...mySlots.values()].flat().filter((sl) => owesData(sl, records.get(sl.id), now)).length
  const data = { records, now, onHandover: (slot: TeamSlot, shootName: string) => setHanding({ slot, shootName }) }

  return (
    <>
      <PageHeader title="My shoots" description="Where you are booked, and when to be there." />
      <HowToUse
        title="Your bookings"
        description="Each card is a shoot you hold a slot on. The times are your slot, not the whole day."
        steps={['Check the date and venue.', 'Note your call time.', 'Ask your manager if something looks off.']}
      />

      {owed > 0 && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <HardDrive className="size-4 shrink-0 text-warning" aria-hidden />
          You have cards from {owed === 1 ? '1 booking' : `${owed} bookings`} to hand over. Tap <b>Hand over data</b> once they are with the studio.
        </p>
      )}
      <div className="mt-6">
        {shoots.isLoading ? (
          <SkeletonCards count={3} />
        ) : shoots.isError ? (
          <ErrorState error={shoots.error} onRetry={() => void shoots.refetch()} />
        ) : !shoots.data || shoots.data.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState title="No shoots booked" description="When a manager books you on a shoot, it will appear here." />
            </CardContent>
          </Card>
        ) : (
          <>
            <Section title="Upcoming" shoots={upcoming} mySlots={mySlots} me={session?.user_id ?? null} data={data} emptyText="Nothing coming up." />
            {past.length > 0 && <Section title="Past" shoots={past} mySlots={mySlots} me={session?.user_id ?? null} data={data} muted />}
          </>
        )}
      </div>
      {handing && (
        <HandoverDialog
          slot={handing.slot}
          shootName={handing.shootName}
          record={records.get(handing.slot.id)}
          onClose={() => setHanding(null)}
        />
      )}
    </>
  )
}

interface DataProps {
  records: Map<string, DataRecord>
  now: string
  onHandover: (slot: TeamSlot, shootName: string) => void
}

function Section({
  title,
  shoots,
  mySlots,
  me,
  data,
  emptyText,
  muted,
}: {
  title: string
  shoots: MyShoot[]
  mySlots: Map<string, TeamSlot[]>
  me: string | null
  data: DataProps
  emptyText?: string
  muted?: boolean
}) {
  return (
    <div className={muted ? 'mt-8' : ''}>
      <h2 className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
      {shoots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shoots.map((s) => {
            const slotsFor = mySlots.get(s.id) ?? []
            const href = mapHref(s.map_link)
            return (
              <Card key={s.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{s.project_name ?? 'No project'}</p>
                    </div>
                    <StatusBadge tone={TONE[s.status]}>{humanize(s.status)}</StatusBadge>
                  </div>
                  <div className="mt-3 flex flex-col gap-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <CalendarDays className="size-4 shrink-0" />
                      {s.shoot_date ? dayFormat.format(new Date(s.shoot_date)) : 'Date to be confirmed'}
                    </span>
                    {s.location && (
                      <span className="flex items-center gap-2">
                        <MapPin className="size-4 shrink-0" />
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            {s.location}
                          </a>
                        ) : (
                          s.location
                        )}
                      </span>
                    )}
                    {s.map_link && !href && (
                      <span className="flex items-center gap-2">
                        <MapPin className="size-4 shrink-0" />
                        <span className="select-all">{s.map_link}</span>
                      </span>
                    )}
                  </div>
                  {slotsFor.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-sm">
                      {slotsFor.map((sl) => (
                        <li key={sl.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold tabular-nums">
                            {timeFormat.format(new Date(sl.start_at))} – {timeFormat.format(new Date(sl.end_at))}
                          </span>
                          <span className="text-muted-foreground">{sl.service_name ?? 'Crew'}</span>
                          <StatusBadge tone={sl.status === 'booked' ? 'success' : 'neutral'}>{humanize(sl.status)}</StatusBadge>
                          {sl.status === 'booked' && sl.end_at >= data.now && (
                            <Button variant="outline" size="sm" className="ml-auto h-7" onClick={() => downloadIcs(sl)}>
                              <CalendarPlus /> Add to calendar
                            </Button>
                          )}
                          <DataLine slot={sl} record={data.records.get(sl.id)} now={data.now} onHandover={() => data.onHandover(sl, s.name)} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.crew.filter((c) => c.user_id !== me).length > 0 && (
                    <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                      <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>
                        With{' '}
                        {s.crew
                          .filter((c) => c.user_id !== me)
                          .map((c) => (c.service_name ? `${c.name} (${c.service_name})` : c.name))
                          .join(', ')}
                      </span>
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** My data for one booking: what the studio has, and the way to hand it over. */
function DataLine({ slot, record, now, onHandover }: { slot: TeamSlot; record?: DataRecord | undefined; now: string; onHandover: () => void }) {
  if (slot.status !== 'booked' || slot.end_at >= now || optedOut(slot)) return null
  const stage = record?.data_status
  const canHand = !record || stage === 'with_shooter' || stage === 'received'
  return (
    <span className="ml-auto flex items-center gap-2">
      <StatusBadge tone={record ? STAGE_TONE[record.data_status] : 'danger'}>
        {record ? STAGE_LABEL[record.data_status] : 'Not handed over'}
      </StatusBadge>
      {canHand && (
        <Button size="sm" variant={stage === 'received' ? 'outline' : 'default'} className="h-7" onClick={onHandover}>
          <HardDrive /> {stage === 'received' ? 'Update' : 'Hand over data'}
        </Button>
      )}
    </span>
  )
}
