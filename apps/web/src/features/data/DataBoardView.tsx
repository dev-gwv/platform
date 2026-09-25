import { useMemo, useState, type ReactNode } from 'react'
import { Download, ExternalLink, MessageCircle, Pencil, Phone, Search, X } from 'lucide-react'
import type { BulkDataAction, DataBoardRow } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { MetricCard } from '@/shared/ui/metric-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { cn } from '@/shared/ui/cn'
import { useBulkData, useStorageLocations } from './api'
import {
  BULK_ACTIONS,
  FOCI,
  LANES,
  bulkIds,
  byAge,
  chaseMessage,
  figures,
  inFocus,
  laneOf,
  levelOf,
  matches,
  mostPending,
  nextAction,
  waNumber,
  type Focus,
  type Level,
} from './board-model'
import { STAGE_LABEL, STAGE_TONE } from './stage'

const LEVEL_RING: Record<Level, string> = {
  ok: 'border-border',
  late: 'border-warning/60',
  critical: 'border-destructive/70',
}

const day = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : 'No date'

/**
 * Every booked person's cards, from the shoot day to the archive. Lanes left
 * to right are how safe the footage is; a card turns amber after 3 days and
 * red after 7 while it is not yet in two places. Tick cards to move many at
 * once -- "copied to HDD 4" for a whole crew is one click.
 */
export function DataBoardView({
  rows,
  truncated,
  onOpen,
}: {
  rows: readonly DataBoardRow[]
  truncated: boolean
  /** Open the record for a row (add or edit). */
  onOpen: (row: DataBoardRow) => void
}) {
  const [focus, setFocus] = useState<Focus>('open')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const open = useMemo(() => rows.filter((r) => inFocus(r, 'open')), [rows])
  const f = useMemo(() => figures(open), [open])
  const holders = useMemo(() => mostPending(open), [open])
  const shown = useMemo(() => rows.filter((r) => inFocus(r, focus) && matches(r, q)).sort(byAge), [rows, focus, q])
  const pickedRows = shown.filter((r) => picked.has(r.key))

  const toggle = (keys: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })

  function exportCsv() {
    downloadCsv(
      `data-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['Shoot date', 'Shoot', 'Project', 'Client', 'Person', 'Role', 'Stage', 'Days since shoot', 'Cards', 'Size (GB)', 'Main copy', 'Main folder', 'Backup', 'Backup folder', 'Verified by', 'Next step'],
        shown.map((r) => [
          r.shoot_date,
          r.shoot_name,
          r.project_name,
          r.client_name,
          r.user_name,
          r.role,
          STAGE_LABEL[r.stage],
          r.age_days,
          r.record?.card_count ?? '',
          r.record?.size_gb ?? '',
          r.record?.primary_location_name,
          r.record?.folder_path,
          r.record?.backup_location_name,
          r.record?.backup_folder_path,
          r.record?.verified_by_name,
          nextAction(r),
        ]),
      ),
    )
  }

  const lanesShown = focus === 'open' || focus === 'late'

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure onClick={() => setFocus('open')}>
          <MetricCard
            label="With crew"
            value={f.crew}
            tone={f.crew ? 'danger' : 'success'}
            hint={f.critical ? `${f.critical} critical (7+ days)` : f.late ? `${f.late} late (3+ days)` : 'Cards not handed over'}
          />
        </Figure>
        <Figure onClick={() => setFocus('open')}>
          <MetricCard label="To copy" value={f.received} tone={f.received ? 'warning' : 'success'} hint="In the studio, one copy to make" />
        </Figure>
        <Figure onClick={() => setFocus('open')}>
          <MetricCard label="Needs backup" value={f.copied} tone={f.copied ? 'warning' : 'success'} hint="Only one copy so far" />
        </Figure>
        <Figure onClick={() => setFocus('issues')}>
          <MetricCard label="Issues" value={f.issues} tone={f.issues ? 'danger' : 'muted'} hint="A copy with a problem" />
        </Figure>
      </div>

      {holders.length > 0 && <ChaseStrip holders={holders} />}

      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs tabs={FOCI.map((x) => ({ value: x.key, label: x.label }))} value={focus} onChange={setFocus} />
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search data"
            placeholder="Shoot, project, person, disk…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!shown.length}>
          <Download /> CSV
        </Button>
      </div>
      {truncated && <p className="text-xs text-muted-foreground">Showing the oldest 3,000. Search to narrow it down.</p>}

      {lanesShown ? (
        <div className="-mx-1 overflow-x-auto px-1 pb-2">
          <div className="grid min-w-[80rem] grid-cols-5 gap-3">
            {LANES.map((lane) => {
              const inLane = shown.filter((r) => laneOf(r.stage) === lane.key)
              const all = inLane.length > 0 && inLane.every((r) => picked.has(r.key))
              return (
                <section key={lane.key} aria-label={lane.label} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-muted/40 p-2">
                  <header className="flex items-center gap-2 px-1">
                    <input
                      type="checkbox"
                      aria-label={`Select all in ${lane.label}`}
                      checked={all}
                      disabled={!inLane.length}
                      onChange={(e) => toggle(inLane.map((r) => r.key), e.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">
                        {lane.label} <span className="font-normal text-muted-foreground tabular-nums">{inLane.length}</span>
                      </h3>
                      <p className="truncate text-[11px] text-muted-foreground">{lane.hint}</p>
                    </div>
                  </header>
                  {inLane.map((r) => (
                    <DataCard key={r.key} row={r} picked={picked.has(r.key)} onPick={(on) => toggle([r.key], on)} onOpen={() => onOpen(r)} />
                  ))}
                  {!inLane.length && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here.</p>}
                </section>
              )
            })}
          </div>
        </div>
      ) : shown.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <DataCard key={r.key} row={r} picked={picked.has(r.key)} onPick={(on) => toggle([r.key], on)} onOpen={() => onOpen(r)} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing here.</p>
      )}

      {pickedRows.length > 0 && <DataBulkBar rows={pickedRows} onDone={() => setPicked(new Set())} />}
    </div>
  )
}

function Figure({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  )
}

/** Who to chase first: the people holding the most cards. */
function ChaseStrip({ holders }: { holders: ReturnType<typeof mostPending> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
      <p className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Chase first</p>
      {holders.map((h) => {
        const wa = waNumber(h.phone)
        return (
          <div key={h.user_id} className="flex items-center gap-1 rounded-full border border-border py-0.5 pl-3 pr-1 text-sm">
            <span className="font-medium">{h.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              · {h.count} shoot{h.count === 1 ? '' : 's'}
              {h.oldest >= 3 ? `, ${h.oldest}d` : ''}
            </span>
            {h.phone && (
              <a href={`tel:${h.phone}`} aria-label={`Call ${h.name}`} className="rounded-full p-1.5 text-primary hover:bg-muted">
                <Phone className="size-3.5" />
              </a>
            )}
            {wa && (
              <a
                href={`https://wa.me/${wa}?text=${encodeURIComponent(chaseMessage(h))}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`WhatsApp ${h.name}`}
                className="rounded-full p-1.5 text-success hover:bg-muted"
              >
                <MessageCircle className="size-3.5" />
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DataCard({ row, picked, onPick, onOpen }: { row: DataBoardRow; picked: boolean; onPick: (on: boolean) => void; onOpen: () => void }) {
  const level = levelOf(row)
  const r = row.record
  const link = r?.cloud_link || r?.backup_cloud_link
  return (
    <article
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border bg-card p-3 text-sm shadow-sm',
        LEVEL_RING[level],
        picked && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" aria-label={`Select ${row.user_name ?? 'row'} on ${row.shoot_name ?? 'shoot'}`} checked={picked} onChange={(e) => onPick(e.target.checked)} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{row.user_name ?? r?.data_label ?? 'Data'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[row.role, row.shoot_name].filter(Boolean).join(' · ')}
          </p>
        </div>
        {level !== 'ok' ? (
          <StatusBadge tone={level === 'critical' ? 'danger' : 'warning'}>{row.age_days}d</StatusBadge>
        ) : (
          <span className="text-[11px] text-muted-foreground tabular-nums">{row.age_days ? `${row.age_days}d` : 'Today'}</span>
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {day(row.shoot_date)} · {[row.project_name, row.client_name].filter(Boolean).join(' · ') || 'No project'}
      </p>
      {r && (r.primary_location_name || r.backup_location_name) && (
        <p className="truncate text-xs">
          {r.primary_location_name && <span>Main: {r.primary_location_name}</span>}
          {r.backup_location_name && <span className="text-muted-foreground"> · Backup: {r.backup_location_name}</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={STAGE_TONE[row.stage]}>{STAGE_LABEL[row.stage]}</StatusBadge>
        {r?.handed_to_editor_at && <StatusBadge tone="info">With editor</StatusBadge>}
        <span className="text-xs text-muted-foreground">{nextAction(row)}</span>
      </div>
      <div className="flex flex-wrap gap-1 pt-0.5">
        <Button size="sm" variant={r ? 'outline' : 'default'} onClick={onOpen}>
          <Pencil /> {r ? 'Open' : 'Add data'}
        </Button>
        {!r && row.phone && (
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${row.phone}`}>
              <Phone /> Call
            </a>
          </Button>
        )}
        {link && (
          <Button asChild size="sm" variant="ghost">
            <a href={link} target="_blank" rel="noreferrer">
              <ExternalLink /> Link
            </a>
          </Button>
        )}
      </div>
    </article>
  )
}

/** One change for every ticked card. */
function DataBulkBar({ rows, onDone }: { rows: DataBoardRow[]; onDone: () => void }) {
  const bulk = useBulkData()
  const locations = useStorageLocations()
  const [action, setAction] = useState<BulkDataAction>('received')
  const [location, setLocation] = useState('')
  const [folder, setFolder] = useState('')
  const needs = BULK_ACTIONS.find((a) => a.key === action)?.needsLocation ?? false

  function apply() {
    bulk.mutate(
      { ...bulkIds(rows), action, location_id: needs ? location : null, folder: needs ? folder.trim() || null : null },
      { onSuccess: onDone },
    )
  }

  return (
    <div
      role="region"
      aria-label="Change the selected data"
      className="sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card/95 p-3 shadow-lg backdrop-blur"
    >
      <span className="text-sm font-semibold">{rows.length} selected</span>
      <Select aria-label="What happened" value={action} onChange={(e) => setAction(e.target.value as BulkDataAction)} className="h-9 w-44">
        {BULK_ACTIONS.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </Select>
      {needs && (
        <>
          <Select aria-label="Which location" value={location} onChange={(e) => setLocation(e.target.value)} className="h-9 w-48">
            <option value="">Pick a disk or cloud…</option>
            {(locations.data ?? [])
              .filter((l) => l.is_active)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
          <Input aria-label="Folder" placeholder="Folder (optional)" value={folder} onChange={(e) => setFolder(e.target.value)} className="h-9 w-48" />
        </>
      )}
      <Button size="sm" onClick={apply} disabled={bulk.isPending || (needs && !location)}>
        Apply
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone} aria-label="Clear selection">
        <X />
      </Button>
    </div>
  )
}
