import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, Camera, Check, ClipboardList, Copy, Database, ExternalLink, HardDrive, MapPin, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { MyProject, MyProjectData, MyProjectShoot } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Avatar } from '@/shared/ui/avatar'
import { EventTile } from '@/shared/ui/icon-tile'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { DUE_TONE_CLASS, daysLeft } from '@/shared/ui/days-left'
import { humanize } from '@/shared/ui/format'
import { useMyProject } from '@/features/my-work/api'
import { MyEditRow } from '@/features/projects/MyDeliverables'
import { DeliverableDrawer } from '@/features/projects/DeliverableDrawer'
import { STAGE_LABEL as DATA_STAGE_LABEL } from '@/features/data/stage'

type View = 'work' | 'shoots' | 'data'
const VIEWS: { value: View; label: string; icon: LucideIcon }[] = [
  { value: 'work', label: 'My work', icon: ClipboardList },
  { value: 'shoots', label: 'Shoots & team', icon: Camera },
  { value: 'data', label: 'Data', icon: Database },
]

/**
 * One project as someone who works on it sees it: their own work on it, each
 * shoot day with who shot it, and where each day's data is -- disk, folder,
 * backup, link -- with Copy. Never money, never the client's phone.
 */
export function MyWorkProjectPage() {
  return (
    <AuthedPage module="projects">
      <ProjectForMe />
    </AuthedPage>
  )
}

function ProjectForMe() {
  const { projectId } = useParams({ from: '/authed/my-work/project/$projectId' })
  const q = useMyProject(projectId)
  const [view, setView] = useState<View>(() => {
    const v = new URLSearchParams(window.location.search).get('view')
    return v === 'shoots' || v === 'data' ? v : 'work'
  })

  if (q.isLoading) return <SkeletonList rows={5} columns={3} />
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />
  const p = q.data

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/my-work">
            <ArrowLeft /> My work
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight">{p.name}</h1>
          <p className="text-sm text-muted-foreground">{headline(p)}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5" role="tablist" aria-label="This project">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => setView(v.value)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              view === v.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <v.icon className="size-4" aria-hidden />
            {v.label}
            {v.value === 'data' && <span className="text-xs opacity-80">{p.shoots.reduce((n, s) => n + s.data.length, 0)}</span>}
          </button>
        ))}
      </div>

      {view === 'work' && <WorkView p={p} />}
      {view === 'shoots' && <ShootsView shoots={p.shoots} />}
      {view === 'data' && <DataView shoots={p.shoots} />}
    </section>
  )
}

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** "Mehta · 21–24 Oct · your next edit is due in 4 days". */
function headline(p: MyProject): string {
  const when = p.first_date ? (p.last_date && p.last_date !== p.first_date ? `${day(p.first_date)} – ${day(p.last_date)}` : day(p.first_date)) : null
  const open = p.deliverables.filter((d) => d.status !== 'completed' && d.status !== 'cancelled' && d.estimated_date)
  const next = open.map((d) => daysLeft(d.estimated_date)).filter((x) => !!x).sort((a, b) => a!.days - b!.days)[0]
  return [p.client_name, when, next ? `your next edit: ${next.text.toLowerCase()}` : null].filter(Boolean).join(' · ')
}

function WorkView({ p }: { p: MyProject }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = p.deliverables.find((d) => d.id === openId) ?? null
  const nothing = p.deliverables.length === 0 && p.tasks.length === 0 && p.submissions.length === 0
  if (nothing) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState title="No work for you here yet" description="Your shoots on it are under Shoots & team; where the data is, under Data." />
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {p.deliverables.length > 0 && (
        <ul className="flex flex-col gap-2">
          {p.deliverables.map((d) => (
            <MyEditRow key={d.id} d={d} showProject={false} onOpen={() => setOpenId(d.id)} />
          ))}
        </ul>
      )}
      {p.tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Tasks</h2>
          {p.tasks.map((t) => {
            const left = t.status === 'completed' || t.status === 'cancelled' ? null : daysLeft(t.due_date)
            return (
              <Card key={t.id}>
                <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <span className={cn('font-medium', t.status === 'completed' && 'line-through opacity-70')}>{t.title}</span>
                  {left && <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', DUE_TONE_CLASS[left.tone])}>{left.text}</span>}
                  <StatusBadge className="ml-auto" tone={t.status === 'completed' ? 'success' : 'neutral'}>
                    {humanize(t.status)}
                  </StatusBadge>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      {p.submissions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">What you handed in</h2>
          {p.submissions.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-col gap-1.5 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {s.deliverable_title ?? 'Work'}
                    {s.version ? <span className="text-muted-foreground"> · v{s.version}</span> : null}
                  </span>
                  {s.submission_link && (
                    <a href={s.submission_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      <ExternalLink className="size-3.5" aria-hidden /> Open link
                    </a>
                  )}
                  <StatusBadge className="ml-auto" tone={s.status === 'approved' ? 'success' : s.status === 'rejected' ? 'danger' : 'info'}>
                    {s.status === 'approved' ? 'Approved' : s.status === 'rejected' ? 'Sent back' : 'Waiting for review'}
                  </StatusBadge>
                </div>
                {s.review_notes && (
                  <p className="rounded-lg border-l-2 border-tone-rose bg-tone-rose-soft px-2.5 py-1.5 text-xs">{s.review_notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <DeliverableDrawer
        deliverable={
          open
            ? {
                id: open.id,
                project_id: open.project_id,
                title: open.title,
                description: open.description ?? null,
                list_key: 'primary',
                is_additional_charge: false,
                additional_charge_amount: 0,
                visibility_scope: open.visibility_scope,
                show_on_quotation: open.visibility_scope === 'client',
                estimated_date: open.estimated_date ?? null,
                start_rule: 'whole_project',
                status: open.status,
                shoot_name: open.shoot_name ?? null,
                assignee_id: null,
                assignee_name: null,
                delivery_link: open.delivery_link ?? null,
                custom_status_code: open.custom_status_code ?? null,
                notes_count: open.notes_count,
                voice_count: open.voice_count,
              }
            : null
        }
        canEdit={false}
        action={null}
        onClose={() => setOpenId(null)}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />
    </div>
  )
}

function ShootsView({ shoots }: { shoots: readonly MyProjectShoot[] }) {
  if (shoots.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState title="No shoots on this project" description="When the studio adds the days, they show here." />
        </CardContent>
      </Card>
    )
  }
  return (
    <ul className="flex flex-col gap-3">
      {shoots.map((s) => (
        <li key={s.id}>
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <EventTile name={s.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{s.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[s.shoot_date ? day(s.shoot_date) : 'Date not set', s.start_at ? `${time(s.start_at)}${s.end_at ? `–${time(s.end_at)}` : ''}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {(s.location || s.map_link) && (
                    <p className="mt-0.5 flex items-center gap-1 text-sm">
                      <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                      {s.map_link && /^https?:\/\//i.test(s.map_link) ? (
                        <a href={s.map_link} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          {s.location || 'Open map'}
                        </a>
                      ) : (
                        <span>{s.location}</span>
                      )}
                    </p>
                  )}
                </div>
                <DataPill data={s.data} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who shot it</p>
                {s.crew.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nobody booked yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {s.crew.map((c, i) => (
                      <li
                        key={`${c.user_id ?? c.name}-${i}`}
                        className={cn('flex items-center gap-2 rounded-full border px-2 py-1 text-sm', c.me ? 'border-primary/40 bg-primary/5' : 'border-border')}
                      >
                        <Avatar name={c.name} size="sm" />
                        <span className="font-medium">{c.me ? `${c.name} (you)` : c.name}</span>
                        {c.role && <span className="text-xs text-muted-foreground">{c.role}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}

/** "Data in" green once a copy is made; amber while it is still with the shooter. */
function DataPill({ data }: { data: readonly MyProjectData[] }) {
  if (data.length === 0) return <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">No data yet</span>
  const ready = data.some((d) => ['copied', 'backed_up', 'verified', 'archived'].includes(d.stage))
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', ready ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
      <HardDrive className="size-3.5" aria-hidden /> {ready ? 'Data in' : 'Data on its way'}
    </span>
  )
}

function DataView({ shoots }: { shoots: readonly MyProjectShoot[] }) {
  const withData = shoots.filter((s) => s.data.length > 0)
  if (withData.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState title="No data recorded yet" description="Once the cards are copied, where they are shows here." />
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {withData.map((s) => (
        <div key={s.id} className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <EventTile name={s.name} size="sm" /> {s.name}
            {s.shoot_date && <span className="font-normal text-muted-foreground">· {day(s.shoot_date)}</span>}
          </p>
          {s.data.map((r) => (
            <DataCard key={r.id} r={r} />
          ))}
        </div>
      ))}
    </div>
  )
}

function DataCard({ r }: { r: MyProjectData }) {
  const ready = ['copied', 'backed_up', 'verified', 'archived'].includes(r.stage)
  return (
    <Card className={cn(ready && 'border-success/40')}>
      <CardContent className="flex flex-col gap-2 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.label}</span>
          {r.whose && <span className="text-xs text-muted-foreground">{r.whose}’s cards</span>}
          <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-medium', ready ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
            {DATA_STAGE_LABEL[r.stage as keyof typeof DATA_STAGE_LABEL] ?? humanize(r.stage)}
          </span>
        </div>
        <Where label="Main copy" disk={r.main} folder={r.folder_path} link={r.cloud_link} />
        {(r.backup || r.backup_folder_path || r.backup_cloud_link) && (
          <Where label="Backup" disk={r.backup} folder={r.backup_folder_path} link={r.backup_cloud_link} />
        )}
        <p className="text-xs text-muted-foreground">
          {[
            r.copied_by ? `Copied by ${r.copied_by}` : null,
            r.date_received ? `received ${day(r.date_received)}` : null,
            r.card_count ? `${r.card_count} card${r.card_count === 1 ? '' : 's'}` : null,
            r.size_gb ? `${r.size_gb} GB` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {r.notes && <p className="text-xs">{r.notes}</p>}
      </CardContent>
    </Card>
  )
}

function Where({ label, disk, folder, link }: { label: string; disk: string | null; folder: string | null; link: string | null }) {
  if (!disk && !folder && !link) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
      <span className="w-20 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      {disk && (
        <span className="inline-flex items-center gap-1 font-medium">
          <HardDrive className="size-3.5" aria-hidden /> {disk}
        </span>
      )}
      {folder && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <code className="truncate rounded bg-card px-1.5 py-0.5 text-xs">{folder}</code>
          <CopyButton text={folder} label="Copy path" />
        </span>
      )}
      {link && /^https?:\/\//i.test(link) && (
        <span className="inline-flex items-center gap-1">
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="size-3.5" aria-hidden /> Open link
          </a>
          <CopyButton text={link} label="Copy link" />
        </span>
      )}
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setDone(true)
            window.setTimeout(() => setDone(false), 1500)
          },
          () => toast.error('Could not copy'),
        )
      }}
      className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
    >
      {done ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  )
}
