import { useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Film, FolderOpen, HardDrive, MessageSquare, Mic, Play, Upload } from 'lucide-react'
import type { Deliverable, MyDeliverable } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useMyDeliverables, useStartDeliverable } from '@/features/projects/api'
import { EventTile } from '@/shared/ui/icon-tile'
import { SECTION_LABEL, bySection, waitingFor, workSentence } from '@/features/projects/my-work-sections'
import { DueChip, KindTile, MoveToMenu, NextStageButton } from '@/features/projects/DeliverableCard'
import { SubmitWorkDialog } from '@/features/work/SubmitWorkDialog'
import { Button } from '@/shared/ui/button'
import { DeliverableDrawer } from '@/features/projects/DeliverableDrawer'
import { StageStepper, STAGE_STYLE } from '@/features/projects/StageStepper'
import { isLate, stageOf } from '@/features/projects/deliverable-stage'
import { RemindMe } from '@/features/reminders/RemindMe'
import { changesFirst } from '@/features/projects/revisions'

/** An item on my list, in the shape the panel reads. I am its editor. */
function asDeliverable(d: MyDeliverable, me: { id: string | null; name: string | null }): Deliverable {
  return {
    id: d.id,
    project_id: d.project_id,
    title: d.title,
    description: d.description ?? null,
    list_key: 'primary',
    is_additional_charge: false,
    additional_charge_amount: 0,
    visibility_scope: d.visibility_scope,
    show_on_quotation: d.visibility_scope === 'client',
    estimated_date: d.estimated_date ?? null,
    start_rule: 'whole_project',
    status: d.status,
    shoot_name: d.shoot_name ?? null,
    assignee_id: me.id,
    assignee_name: me.name,
    delivery_link: d.delivery_link ?? null,
    custom_status_code: d.custom_status_code ?? null,
    notes_count: d.notes_count,
    voice_count: d.voice_count,
  }
}

/**
 * What the signed-in person is editing, soonest due first -- and above that,
 * anything sent back for changes, with what the reviewer said and one button
 * to upload the revision. Each one shows where it stands and how many notes
 * are waiting; tapping it opens the same panel the project page has, so an
 * editor can listen to a voice note, reply with one, and say "sent to client"
 * -- without editing the whole project. Renders nothing for someone with no
 * deliverables.
 */
export function MyDeliverables() {
  const { data } = useMyDeliverables({ done: 14 })
  const { session } = useAuth()
  const { searchStr } = useLocation()
  // ?d=<id> opens one straight away -- where a notification about it lands.
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('d'))
  const [openAction, setOpenAction] = useState<'voice' | null>(null)
  useEffect(() => {
    const d = new URLSearchParams(searchStr).get('d')
    if (d) setOpenId(d)
  }, [searchStr])
  if (!data?.length) return null
  const me = { id: session?.user_id ?? null, name: session?.display_name ?? null }
  const open = data.find((d) => d.id === openId)
  const groups = bySection(changesFirst(data))

  return (
    <Card className="mt-4">
      <CardContent className="p-3">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Film className="size-4 text-tone-violet" aria-hidden /> Your edits
        </p>
        <p className="mb-3 text-sm text-muted-foreground">{workSentence(data)}</p>
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.section} aria-label={SECTION_LABEL[g.section]}>
              <h3
                className={cn(
                  'mb-1.5 text-xs font-semibold uppercase tracking-wide',
                  g.section === 'late' || g.section === 'changes' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {SECTION_LABEL[g.section]} · {g.rows.length}
              </h3>
              <ul className="flex flex-col gap-2">
                {g.rows.map((d) => (
                  <MyEditRow key={d.id} d={d} onOpen={() => setOpenId(d.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </CardContent>
      <DeliverableDrawer
        deliverable={open ? asDeliverable(open, me) : null}
        canEdit={false}
        action={openAction}
        onClose={() => {
          setOpenId(null)
          setOpenAction(null)
        }}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />
    </Card>
  )
}

/**
 * One edit, as its editor needs it: what and for whom, the shoots it comes
 * from and whether their data is in (and where), how long is left, and the
 * one thing to do next -- start, hand it in, or upload the revision.
 */
export function MyEditRow({ d, onOpen, showProject = true }: { d: MyDeliverable; onOpen: () => void; showProject?: boolean }) {
  const stage = stageOf(d.status)
  const done = stage === 'completed' || stage === 'cancelled'
  const sentBack = d.changes_requested
  const waiting = waitingFor(d.shoots)
  const start = useStartDeliverable()
  return (
    <li
      className={cn(
        'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-l-4 border-border bg-card px-3 py-2.5 transition-shadow hover:shadow-md',
        done ? 'border-l-tone-green opacity-80' : isLate(d) ? 'border-l-destructive' : sentBack ? 'border-l-tone-rose' : STAGE_STYLE[stage].border,
      )}
      onClick={onOpen}
    >
      <KindTile title={d.title} status={d.status} />
      <div className="min-w-[12rem] flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-semibold">{d.title}</span>
          {sentBack && !done && <StatusBadge tone="danger">Changes requested</StatusBadge>}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          {showProject && (
            <span className="font-medium text-foreground">
              {d.project_name}
              {d.client_name ? <span className="font-normal text-muted-foreground"> · {d.client_name}</span> : null}
            </span>
          )}
          {!done && <DueChip d={d} />}
          {d.voice_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tone-blue-soft px-2 py-0.5 font-medium text-tone-blue">
              <Mic className="size-3" aria-hidden /> {d.voice_count}
            </span>
          )}
          {d.notes_count - d.voice_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
              <MessageSquare className="size-3" aria-hidden /> {d.notes_count - d.voice_count}
            </span>
          )}
        </div>
        {d.shoots.length > 0 && !done && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {d.shoots.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2">
                <EventTile name={s.name} size="sm" className="size-5 rounded-full" />
                {s.name}
                {s.shoot_date && <span className="text-muted-foreground">· {shortDay(s.shoot_date)}</span>}
              </span>
            ))}
            {waiting ? (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">{waiting}</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 font-medium text-success">
                <HardDrive className="size-3" aria-hidden /> Data ready{d.data_where ? ` · ${d.data_where}` : ''}
              </span>
            )}
          </div>
        )}
        {sentBack && !done ? (
          <p className="mt-1.5 line-clamp-2 break-words rounded-lg border-l-2 border-tone-rose bg-tone-rose-soft px-2.5 py-1.5 text-xs">
            {d.review_note ?? <span className="text-muted-foreground">Open it to see what to change.</span>}
          </p>
        ) : (
          !done && (
            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
              <MoveToMenu d={d} canEdit={false}>
                <StageStepper status={d.status} code={d.custom_status_code} />
              </MoveToMenu>
            </div>
          )
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <span className="text-xs font-medium text-tone-green">{stage === 'completed' ? 'Delivered' : 'Dropped'}</span>
        ) : sentBack ? (
          <SubmitWorkDialog
            deliverableId={d.id}
            projectId={d.project_id}
            reviewer={d.assigned_by_name}
            revision={{ lastVersion: d.last_version, note: d.review_note }}
            trigger={
              <Button size="sm">
                <Upload /> Upload revision
              </Button>
            }
          />
        ) : (
          <>
            {!d.started_at && stage !== 'review' && (
              <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => start.mutate(d.id)}>
                <Play /> I've started
              </Button>
            )}
            {stage !== 'review' && (
              <SubmitWorkDialog
                deliverableId={d.id}
                projectId={d.project_id}
                reviewer={d.assigned_by_name}
                trigger={
                  <Button size="sm" className={cn(d.started_at && 'ipc-nudge')}>
                    <Upload /> Hand in work
                  </Button>
                }
              />
            )}
            {stage === 'review' && <NextStageButton id={d.id} status={d.status} code={d.custom_status_code} link={d.delivery_link} canEdit={false} />}
          </>
        )}
        {showProject && (
          <Button size="sm" variant="ghost" asChild>
            <Link to="/my-work/project/$projectId" params={{ projectId: d.project_id }}>
              <FolderOpen /> Open project
            </Link>
          </Button>
        )}
        {!done && <RemindMe entityType="deliverable" entityId={d.id} name={d.title} context={d.project_name} />}
      </div>
    </li>
  )
}

const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
