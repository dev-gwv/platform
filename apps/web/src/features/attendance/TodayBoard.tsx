import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import type { TodayBoardRow } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useTodayBoard } from './api'
import { GROUP_LABEL, GROUP_ORDER, boardSentence, clockText, dayClock, groupRows, inLine, overdue, type BoardGroup } from './board'
import { CorrectDialog } from './CorrectDialog'
import { SelfieThumb } from './SelfieThumb'

const TONE: Record<BoardGroup, string> = {
  not_in: 'text-warning',
  late: 'text-warning',
  in: 'text-success',
  shoot: 'text-tone-violet',
  leave: 'text-muted-foreground',
}

const nowClock = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Today, for whoever runs the studio: one sentence, then everyone the studio
 * tracks under where they are. Each row opens its correction.
 */
export function TodayBoard() {
  const board = useTodayBoard()
  const [showLeave, setShowLeave] = useState(false)
  if (board.isLoading) return <SkeletonList rows={5} columns={3} />
  if (board.isError || !board.data) return <ErrorState onRetry={() => void board.refetch()} />
  const b = board.data
  if (!b.enabled) {
    // One slim line with its one button, not a page-filling box.
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <p className="text-sm">
          <span className="font-semibold">Attendance is off.</span> <span className="text-muted-foreground">Nobody is marked or cut.</span>
        </p>
        <Button asChild size="sm">
          <Link to="/settings/attendance-location">Turn it on</Link>
        </Button>
      </div>
    )
  }
  if (b.day_off) return <EmptyState title={b.day_off} description="Nobody is expected in today." />
  if (b.rows.length === 0) return <EmptyState title="Nobody to track" description="Everyone on your team is set to not tracked." />

  const groups = groupRows(b.rows)
  const clock = nowClock()
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">{boardSentence(b.rows)}</p>
      {GROUP_ORDER.map((g) => {
        const rows = groups[g]
        if (!rows.length) return null
        const folded = g === 'leave' && !showLeave
        return (
          <Card key={g}>
            <CardContent className="p-3">
              <button
                type="button"
                className={cn('mb-1 flex w-full items-center gap-2 text-left text-sm font-semibold', TONE[g])}
                onClick={() => g === 'leave' && setShowLeave((v) => !v)}
                disabled={g !== 'leave'}
              >
                {GROUP_LABEL[g]} <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{rows.length}</span>
                {g === 'leave' && <ChevronDown className={cn('ml-auto size-4 transition-transform', showLeave && 'rotate-180')} />}
              </button>
              {!folded && (
                <ul className="divide-y divide-border">
                  {rows.map((r) => (
                    <BoardRow key={r.user_id} r={r} group={g} late={g === 'not_in' && overdue(r, clock)} date={b.date} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function BoardRow({ r, group, late, date }: { r: TodayBoardRow; group: BoardGroup; late: boolean; date: string }) {
  const line =
    group === 'shoot' && r.shoot
      ? `${r.shoot.name} · ${clockText(r.shoot.start_at)}–${clockText(r.shoot.end_at)} · ${
          r.shoot.arrived_at ? `reached ${clockText(r.shoot.arrived_at)}` : 'not reached yet'
        }`
      : group === 'leave'
        ? 'Approved leave'
        : group === 'not_in'
          ? r.expected
            ? `Day starts ${dayClock(r.expected)}${r.leave === 'half' ? ' · half-day leave' : ''}`
            : 'No start time set'
          : inLine(r)
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <Avatar name={r.name} src={r.avatar_url} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{r.name}</p>
        <p className={cn('truncate text-xs', late ? 'font-medium text-warning' : 'text-muted-foreground')}>{line}</p>
      </div>
      {r.selfie_file_id && <SelfieThumb fileId={r.selfie_file_id} name={r.name} />}
      {group !== 'leave' && (
        <CorrectDialog
          row={{ user_id: r.user_id, name: r.name, status: r.status ?? 'absent', check_in_at: r.check_in_at, check_out_at: r.check_out_at, correction_note: null }}
          date={date}
        />
      )}
    </li>
  )
}
