import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CalendarClock, PhoneCall, Plus, Receipt, type LucideIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { projectTrackingRow, shootListItem } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { cn } from '@/shared/ui/cn'
import {
  BAND_TONE,
  NEXT_ACTION_LABEL,
  track,
  type TrackedProject,
} from '@/features/projects/tracking'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { PageHeader } from '@/shared/layout/page-header'
import { PanelBoundary } from '@/shared/layout/RouteError'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { useProjects } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useMembers } from '@/features/allocation/api'
import { useBillingDue } from '@/features/billing/api'
import { useCallQueue } from '@/features/crm-calls/api'
import { useSlots } from '@/features/allocation/api'
import { crewState } from '@ipc/domain'
import { StaffHome, YourDayStrip } from '@/features/dashboard/StaffHome'
import { WhoYouOwe } from '@/features/dashboard/WhoYouOwe'
import { GettingStartedCard, useGettingStartedShowing } from '@/features/dashboard/GettingStartedCard'
import { GuideCard } from '@/features/help/GuideCard'
import { ProfileBanner } from '@/features/profile/ProfileBanner'
import { LowBalanceBanner } from '@/features/messaging/LowBalanceBanner'
import { buildJourney, isSetupAudience } from '@/features/onboarding/journey'
import { useCloseSetup } from '@/features/onboarding/setup-flow'
import { SetupJourney } from '@/features/onboarding/SetupJourney'
import { todayInIndia } from '@/shared/ui/days-left'
import { greeting, todayLine } from '@/features/dashboard/greeting'
import { leadsTileLine, moneyTile, shootsTile } from '@/features/dashboard/tiles'
import { seesStudioWork } from '@ipc/permissions'
import { useINR } from '@/shared/money/MoneyMask'

export function DashboardPage() {
  return <DashboardInner />
}

/**
 * Staff -- anyone who does not see the studio's work (seesStudioWork) -- get
 * their own day (StaffHome); everyone else gets the studio command center,
 * with their own day in one line above it when they have one.
 *
 * The two bodies are separate components rather than two branches of one,
 * because the command center opens with nine hooks. Branching inside a single
 * component meant an employee whose session resolved after the first paint
 * rendered the owner half once and the employee half next — different hook
 * counts, and React throws.
 */
function DashboardInner() {
  const { session } = useAuth()
  const access = useAccess()
  // Whoever does not see the studio's work gets their own day instead.
  if (session && !seesStudioWork(access)) {
    const first = (session.display_name ?? '').split(' ')[0]
    return (
      <>
        <PageHeader title={first ? `Hi, ${first}` : 'Home'} />
        <GuideCard />
        <div className="mt-4">
          <StaffHome />
        </div>
      </>
    )
  }
  return <StudioCommandCenter />
}

function StudioCommandCenter() {
  const inr = useINR()
  const { session } = useAuth()
  const access = useAccess()

  const projects = useProjects()
  const clients = useClients()
  const members = useMembers()

  // The dashboard's operational half runs off the same tracking pass the
  // Project Tracking screen uses, so the two can never disagree about which
  // job is on fire.
  const trackingRows = useQuery({
    queryKey: ['projects', 'tracking'],
    queryFn: () => callApi('/projects/tracking', { responseSchema: projectTrackingRow.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: shootListItem.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
  const today = todayInIndia()
  const tracked = track(trackingRows.data ?? [], today)
  const clientCount = Array.isArray(clients.data) ? clients.data.length : 0
  const startShowing = useGettingStartedShowing()

  // The three tiles' data: today's calls, the bookings against the week's
  // shoots, and what is due by the Payments received rule.
  const canCrm = access.hasModule('crm')
  const queue = useCallQueue(access.hasAction('crm', 'edit') ? 'all' : 'mine')
  const slots = useSlots()
  const due = useBillingDue({ from: `${today.slice(0, 8)}01`, to: today })
  const booked = (slots.data ?? []).filter((x) => x.status === 'booked')
  const week = shootsTile(
    shoots.data ?? [],
    (id) => {
      const s = (shoots.data ?? []).find((x) => x.id === id)
      const state = s ? crewState(id, s.requirements, booked) : 'unplanned'
      return state === 'unassigned' || state === 'partial'
    },
    today,
  )
  const money = due.data ? moneyTile(due.data, inr) : null
  const tiles = [
    canCrm && (
      <Tile
        key="leads"
        icon={PhoneCall}
        value={queue.data?.items.length ?? '–'}
        label="Leads to call"
        hint={queue.data ? leadsTileLine(queue.data.items) : undefined}
        tone={queue.data?.items.length ? 'warning' : 'success'}
        to="/follow-ups/queue"
      />
    ),
    access.hasModule('projects') && (
      <Tile
        key="shoots"
        icon={CalendarClock}
        value={shoots.data ? week.count : '–'}
        label="Shoots this week"
        hint={shoots.data ? week.line : undefined}
        tone={week.short ? 'warning' : 'primary'}
        to="/team-allocation"
      />
    ),
    access.hasModule('billing') && (
      <Tile
        key="money"
        icon={Receipt}
        value={money ? inr(money.amount) : '–'}
        label="To collect"
        hint={money?.line}
        tone={due.data?.overdue.amount ? 'danger' : 'primary'}
        to="/billing/payments"
      />
    ),
  ].filter(Boolean)

  // The setup card is for whoever is standing the studio up, and only until
  // setup is over (done or skipped) -- then it is gone for good.
  const setupAudience = !!session && isSetupAudience(session) && !session.setup_done
  // Waiting on every query first — a half-loaded card would show a step as
  // outstanding and then jump past it, which reads as work being undone.
  //
  // A FAILED query is not pending either, and its data is undefined, so every
  // count above collapses to zero. Without this an established studio hitting
  // a 500 is told to add its first client. Counts we could not load are not
  // counts of zero.
  const queries = [projects, clients, members]
  const anyFailed = queries.some((q) => q.isError)
  const journeyReady = !queries.some((q) => q.isPending) && !anyFailed
  const journey = buildJourney(
    {
      // The owner is in the directory from registration, so they don't count.
      teammates: (members.data ?? []).filter((m) => m.user_id !== session?.user_id).length,
      clients: clientCount,
      projects: projects.data?.length ?? 0,
    },
    (m) => access.hasModule(m),
  )
  const showJourney = setupAudience && journeyReady && !journey.allDone && !!journey.current

  // All three steps satisfied, however they got there: setup is done, for good.
  const closeSetup = useCloseSetup()
  const allDone = setupAudience && journeyReady && journey.allDone
  const closing = useRef(false)
  useEffect(() => {
    if (!allDone || closing.current) return
    closing.current = true
    void closeSetup('done')
  }, [allDone, closeSetup])

  // A studio still being set up sees the setup card and nothing else: no
  // quick actions, no tiles of zeros, no empty lists sitting under a step
  // that tells them to fill those lists. Until the counts are real, a
  // setup-audience viewer sees neither the card nor the body -- otherwise the
  // zeros paint first and are pulled out from under them when the card lands.
  const settingUp = setupAudience && (queries.some((q) => q.isPending) || showJourney)

  return (
    <>
      <PageHeader
        title={
          <>
            <span className="block text-xs font-semibold tracking-wider text-muted-foreground">{todayLine()}</span>
            {greeting(session?.display_name)}
          </>
        }
        description={settingUp ? "Let's set up your studio." : undefined}
        actions={
          !settingUp &&
          access.hasAction('projects', 'create') && (
            <Button asChild>
              <Link to="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          )
        }
      />

      <LowBalanceBanner />

      {settingUp ? (
        showJourney && journey.current && <SetupJourney steps={journey.steps} current={journey.current} />
      ) : (
      <>
      <ProfileBanner />
      <YourDayStrip />
      {session && isSetupAudience(session) && <GettingStartedCard />}
      {/* One onboarding card at a time: Getting started, then the guide. */}
      {!(session && isSetupAudience(session) && startShowing) && <GuideCard />}

      {/* Three tiles, each a sentence and the one place to act (the audit):
          who to call, the week's shoots, and the money due. The figure is
          the same rule as Payments received, so the two never disagree. */}
      {tiles.length > 0 && (
        <div className={cn('mt-4 grid grid-cols-1 gap-2 sm:gap-3', tiles.length === 2 ? 'sm:grid-cols-2' : tiles.length === 3 && 'sm:grid-cols-3')}>
          {tiles}
        </div>
      )}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        {access.hasModule('projects') && (
          <PanelBoundary label="Needs attention">
            <NeedsAttention projects={tracked} />
          </PanelBoundary>
        )}
        <PanelBoundary label="Who you owe">
          <WhoYouOwe />
        </PanelBoundary>
      </div>
      </>
      )}
    </>
  )
}
/** One counter, with its icon tile. Clickable when there is somewhere to go. */
function Tile({
  icon: Icon,
  value,
  label,
  hint,
  tone,
  to,
  search,
}: {
  icon: LucideIcon
  value: number | string
  label: string
  hint?: string | undefined
  tone: 'primary' | 'danger' | 'warning' | 'success'
  to?: string
  /** Opens the target on a tab, e.g. { tab: 'overdue' }. */
  search?: Record<string, string>
}) {
  const body = (
    <CardContent className="flex items-center gap-3 p-3 sm:p-4">
      <span
        className={cn(
          'hidden size-10 shrink-0 items-center justify-center rounded-lg sm:flex',
          tone === 'danger'
            ? 'bg-destructive/10 text-destructive'
            : tone === 'warning'
              ? 'bg-warning/10 text-warning'
              : tone === 'success'
                ? 'bg-success/10 text-success'
                : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold tabular-nums leading-tight sm:text-xl">{value}</p>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{label}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </CardContent>
  )
  return to ? (
    <Card className="lift">
      <Link to={to} search={search ?? {}} className="block">
        {body}
      </Link>
    </Card>
  ) : (
    <Card>{body}</Card>
  )
}

/**
 * What is going wrong, worst first.
 *
 * The scoring is the same pass Project Tracking uses, so a project called
 * critical here is critical there — two screens disagreeing about which job is
 * on fire is worse than neither of them saying.
 */
function NeedsAttention({ projects }: { projects: readonly TrackedProject[] }) {
  const worst = [...projects]
    .filter((p) => p.health.score > 0)
    .sort((a, b) => b.health.score - a.health.score)
    .slice(0, 3)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <CardTitle>Needs attention</CardTitle>
        {worst.length > 0 && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/project-tracking">
              See all <ArrowRight />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {worst.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">All clear. Every project has its next step covered.</p>
        ) : (
          // One line per project: its name, the one thing wrong, and the way in.
          <ul className="divide-y divide-border">
            {worst.map((p) => (
              <li key={p.id}>
                <Link
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className="flex items-center gap-3 py-2.5 hover:text-primary"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      BAND_TONE[p.health.band] === 'danger' ? 'bg-destructive' : 'bg-warning',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {worstFlag(p) ?? NEXT_ACTION_LABEL[p.health.next_action]}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** The single symptom worth naming on a Needs-attention row. */
function worstFlag(p: TrackedProject): string | null {
  if (p.data_records_unverified > 0) return `${p.data_records_unverified} cards not backed up`
  if (p.tasks_overdue > 0) return `${p.tasks_overdue} overdue task${p.tasks_overdue === 1 ? '' : 's'}`
  if (p.pending_reviews > 0) return `${p.pending_reviews} awaiting review`
  if (p.tasks_total === 0 && p.deliverables_total === 0) return 'No work items created yet'
  if (p.shoots_total === 0) return 'No shoot scheduled'
  return null
}
