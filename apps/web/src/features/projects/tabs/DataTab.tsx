import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Database, ExternalLink, HardDrive } from 'lucide-react'
import type { DataBoardRow } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { useBulkData, useDataBoard, useDeleteDataRecord } from '@/features/data/api'
import { byAge, figures, nextAction } from '@/features/data/board-model'
import { STAGE_LABEL, STAGE_TONE } from '@/features/data/stage'
import { DataRecordDialog } from '@/features/data/DataRecordDialog'

const shortDay = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null

/** The step a row can take in one press, when it needs no disk to be named. */
function quickStep(row: DataBoardRow): { action: 'received' | 'verified'; label: string } | null {
  if (row.stage === 'missing' || row.stage === 'with_shooter') return row.slot_id ? { action: 'received', label: 'Mark received' } : null
  if (row.stage === 'backed_up') return { action: 'verified', label: 'Mark verified' }
  return null
}

/**
 * This project's data, on the project: where every card from its shoots has
 * got to, as the old app's Data tab showed it -- a few figures, then one row
 * per person who shot, with the next step on the row. The same rows as the
 * Data & Backup page, narrowed to this project, so the two never disagree.
 */
export function DataTab({ projectId }: { projectId: string }) {
  const board = useDataBoard(projectId)
  const bulk = useBulkData()
  const del = useDeleteDataRecord()
  const confirm = useConfirm()
  const [opened, setOpened] = useState<DataBoardRow | null>(null)

  const rows = [...(board.data?.rows ?? [])].sort(byAge)
  const f = figures(rows)
  const safe = rows.filter((r) => ['backed_up', 'verified', 'archived', 'not_required'].includes(r.stage)).length

  const open = (r: DataBoardRow) => {
    if (r.slot_id && r.shoot_id) setOpened(r)
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <HardDrive className="size-4 text-muted-foreground" aria-hidden /> Where this project&apos;s data is
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/data-management" search={{ project: projectId } as never}>
            <ExternalLink /> Open Data &amp; Backup
          </Link>
        </Button>
      </div>

      {board.isLoading ? (
        <SkeletonList rows={3} columns={4} />
      ) : board.isError ? (
        <ErrorState onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing shot yet"
          description="Everyone booked on a shoot shows up here once the day has passed, until their cards are safe."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="With the crew" value={f.crew} warn={f.crew > 0} />
            <Figure label="To copy" value={f.received} warn={f.received > 0} />
            <Figure label="Needs backup" value={f.copied} warn={f.copied > 0} />
            <Figure label="Safe" value={safe} good={safe === rows.length} />
          </div>
          {f.issues > 0 && (
            <p className="text-sm text-destructive">
              {f.issues} {f.issues === 1 ? 'card has' : 'cards have'} an issue — open the row to sort it out.
            </p>
          )}

          <Card>
            <CardContent className="p-0">
              {/* Wide screens: the old app's table. */}
              <div className="table-wrap hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Shoot</th>
                      <th className="px-3 py-2 font-medium">Shooter</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Main copy</th>
                      <th className="px-3 py-2 font-medium">Backup</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium">Next</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-border align-top">
                        <td className="px-3 py-2.5">
                          <p className="font-medium">{r.shoot_name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{shortDay(r.shoot_date)}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p>{r.user_name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">
                            {[r.role, r.record?.copied_by_name ? `copied by ${r.record.copied_by_name}` : null].filter(Boolean).join(' · ')}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{r.record?.data_type ?? '—'}</td>
                        <td className="max-w-[12rem] px-3 py-2.5">
                          <p className="truncate">{r.record?.primary_location_name ?? '—'}</p>
                          {r.record?.folder_path && <p className="truncate text-xs text-muted-foreground">{r.record.folder_path}</p>}
                        </td>
                        <td className="max-w-[12rem] px-3 py-2.5">
                          <p className="truncate">{r.record?.backup_location_name ?? '—'}</p>
                          {r.record?.backup_folder_path && (
                            <p className="truncate text-xs text-muted-foreground">{r.record.backup_folder_path}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</StatusBadge>
                        </td>
                        <td className="px-3 py-2.5">
                          <RowActions r={r} onOpen={open} bulk={bulk} del={del} confirm={confirm} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phones: one card per person. */}
              <ul className="flex flex-col divide-y divide-border md:hidden">
                {rows.map((r) => (
                  <li key={r.key} className="flex flex-col gap-1.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {r.user_name ?? '—'} <span className="font-normal text-muted-foreground">· {r.role ?? 'crew'}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[r.shoot_name, shortDay(r.shoot_date)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <StatusBadge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</StatusBadge>
                    </div>
                    {(r.record?.primary_location_name || r.record?.backup_location_name) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {[r.record?.primary_location_name && `Main: ${r.record.primary_location_name}`, r.record?.backup_location_name && `Backup: ${r.record.backup_location_name}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    <RowActions r={r} onOpen={open} bulk={bulk} del={del} confirm={confirm} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {opened && opened.slot_id && opened.shoot_id && (
        <DataRecordDialog
          projectId={projectId}
          shoot={{ id: opened.shoot_id, name: opened.shoot_name ?? 'Shoot' }}
          slot={{
            id: opened.slot_id,
            user_id: opened.user_id ?? '',
            user_name: opened.user_name,
            service_name: opened.role,
            start_at: opened.start_at ?? `${opened.shoot_date ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
            end_at: opened.end_at ?? `${opened.shoot_date ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
          }}
          record={opened.record ?? undefined}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}

/** The row's next step in one press where it can be, the details dialog where a disk has to be named. */
function RowActions({
  r,
  onOpen,
  bulk,
  del,
  confirm,
}: {
  r: DataBoardRow
  onOpen: (r: DataBoardRow) => void
  bulk: ReturnType<typeof useBulkData>
  del: ReturnType<typeof useDeleteDataRecord>
  confirm: ReturnType<typeof useConfirm>
}) {
  const quick = quickStep(r)
  const next = nextAction(r)
  const editable = !!(r.slot_id && r.shoot_id)
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {quick ? (
        <Button
          size="sm"
          variant="outline"
          disabled={bulk.isPending}
          onClick={() => bulk.mutate({ ...(r.slot_id ? { slot_ids: [r.slot_id] } : { record_ids: [r.record!.id] }), action: quick.action })}
        >
          {quick.label}
        </Button>
      ) : editable && !['verified', 'archived', 'not_required'].includes(r.stage) ? (
        <Button size="sm" variant="outline" onClick={() => onOpen(r)}>
          {next}
        </Button>
      ) : (
        <span className={cn('text-xs text-muted-foreground')}>{next}</span>
      )}
      <RowMenu
        label="More"
        items={[
          ...(editable ? [{ label: 'Edit', icon: <Database />, onSelect: () => onOpen(r) }] : []),
          ...(r.record
            ? [
                {
                  label: 'Delete record',
                  onSelect: async () => {
                    if (await confirm({ title: 'Delete this data record?', description: 'The shoot and the booking stay; only where the cards went is forgotten.', confirmLabel: 'Delete', destructive: true })) {
                      del.mutate(r.record!.id)
                    }
                  },
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}

function Figure({ label, value, warn = false, good = false }: { label: string; value: number; warn?: boolean; good?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className={cn('text-xl font-semibold tabular-nums', warn ? 'text-warning' : good ? 'text-success' : '')}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
