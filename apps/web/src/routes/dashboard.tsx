import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Plus,
  Receipt,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { projectTrackingRow, shootListItem, type ShootListItem } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { cn } from '@/shared/ui/cn'
import {
  BAND_TONE,
  NEXT_ACTION_LABEL,
  summary,
  track,
  type TrackedProject,
} from '@/features/projects/tracking'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { useProjects } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useMembers } from '@/features/allocation/api'
import { useInvoices } from '@/features/billing/api'
import { StaffHome, YourDayStrip } from '@/features/dashboard/StaffHome'
import { MyTasksCard } from '@/features/tasks/MyTasksCard'
import { WhoYouOwe } from '@/features/dashboard/WhoYouOwe'
import { GettingStartedCard } from '@/features/dashboard/GettingStartedCard'
import { GuideCard } from '@/features/help/GuideCard'
import { ProfileBanner } from '@/features/profile/ProfileBanner'
import { LowBalanceBanner } from '@/features/messaging/LowBalanceBanner'
import { buildJourney, isSetupAudience } from '@/features/onboarding/journey'
import { useCloseSetup } from '@/features/onboarding/setup-flow'
import { SetupJourney } from '@/features/onboarding/SetupJourney'
import { EventTile } from '@/shared/ui/icon-tile'
import { todayInIndia } from '@/shared/ui/days-left'
import { greeting, todayLine } from '@/features/dashboard/greeting'
import { attentionLine, collectLine, shootsWeekLine } from '@/features/dashboard/tiles'
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
  const invoices = useInvoices()

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
  const totals = summary(tracked)

  const activeProjects = (projects.data ?? []).filter((p) => p.status === 'active').length
  const clientCount = Array.isArray(clients.data) ? clients.data.length : 0
  const outstanding = (invoices.data?.items ?? []).reduce((s, i) => s + i.balance_due, 0)

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
  const queries = [projects, clients, members, invoices]
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
      <GuideCard />

      {/* Three numbers, the way a project page opens: what is running, what
          needs a hand, what is still to come in. Everything else is one
          click away in the menu. */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        <Tile
          icon={Activity}
          value={activeProjects}
          label="Active projects"
          hint={access.hasModule('projects') ? shootsWeekLine(shoots.data ?? [], today) : undefined}
          tone="primary"
          to="/projects"
        />
        <Tile
          icon={AlertTriangle}
          value={totals.attention}
          label="Need attention"
          hint={attentionLine(totals)}
          tone={totals.attention > 0 ? 'danger' : 'success'}
          to="/project-tracking"
          search={{ tab: 'attention' }}
        />
        {access.hasModule('billing') && (
          <Tile
            icon={Receipt}
            value={inr(outstanding)}
            label="To collect"
            hint={collectLine(invoices.data?.items ?? [], today)}
            tone="warning"
            to="/billing/invoices"
          />
        )}
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        {access.hasModule('projects') && <NeedsAttention projects={tracked} />}
        <div className="flex flex-col gap-4">
          <WhoYouOwe />
          {access.hasModule('projects') && <UpcomingShoots shoots={shoots.data ?? []} />}
          <MyTasksCard hideWhenEmpty />
        </div>
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
  icon: typeof Activity
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

/** The next week of shoot days, so nobody finds out on the morning. */
function UpcomingShoots({ shoots }: { shoots: readonly ShootListItem[] }) {
  const today = todayInIndia()
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const soon = shoots
    .filter((s) => s.shoot_date && s.shoot_date >= today && s.shoot_date <= horizon)
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => (a.shoot_date ?? '').localeCompare(b.shoot_date ?? ''))
    .slice(0, 3)

  // Nothing this week: no card saying so.
  if (soon.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <CardTitle>Coming up</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/team-allocation">
            See all <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {soon.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <EventTile name={s.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.project_name ?? '—'}</span>
              </span>
              {s.shoot_date && <span className="shrink-0 text-xs text-muted-foreground">{prettyDay(s.shoot_date)}</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const prettyDay = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00`))

/** The single symptom worth naming on a Needs-attention row. */
function worstFlag(p: TrackedProject): string | null {
  if (p.data_records_unverified > 0) return `${p.data_records_unverified} cards not backed up`
  if (p.tasks_overdue > 0) return `${p.tasks_overdue} overdue task${p.tasks_overdue === 1 ? '' : 's'}`
  if (p.pending_reviews > 0) return `${p.pending_reviews} awaiting review`
  if (p.tasks_total === 0 && p.deliverables_total === 0) return 'No work items created yet'
  if (p.shoots_total === 0) return 'No shoot scheduled'
  return null
}
