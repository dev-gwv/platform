import { Link } from '@tanstack/react-router'
import { HardDrive } from 'lucide-react'
import { useDataBoard } from './api'
import { figures, inFocus } from './board-model'

/**
 * A project's data in one line, above its shoots: how much is still with the
 * crew, waiting to be copied or backed up, and how much is safe -- with the
 * way to the board. Nothing shows until a shoot day has passed.
 */
export function ProjectDataStrip({ projectId }: { projectId: string }) {
  const board = useDataBoard(projectId)
  const rows = (board.data?.rows ?? []).filter((r) => inFocus(r, 'open'))
  if (!rows.length) return null
  const f = figures(rows)
  const safe = rows.length - f.crew - f.received - f.copied - f.issues
  const parts = [
    f.crew && `${f.crew} with crew`,
    f.received && `${f.received} to copy`,
    f.copied && `${f.copied} need backup`,
    f.issues && `${f.issues} with an issue`,
  ].filter(Boolean)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
      <HardDrive className="size-4 text-muted-foreground" aria-hidden />
      <span className="font-medium">Data</span>
      <span className={parts.length ? 'text-warning' : 'text-success'}>
        {parts.length ? parts.join(' · ') : 'All safe'}
      </span>
      <span className="text-muted-foreground">· {safe} of {rows.length} safe</span>
      {f.late + f.critical > 0 && <span className="text-destructive">· {f.late + f.critical} late</span>}
      <Link to="/data-management" className="ml-auto text-xs font-medium text-primary hover:underline">
        Open data board
      </Link>
    </div>
  )
}
