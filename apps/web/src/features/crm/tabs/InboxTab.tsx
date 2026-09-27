import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, Columns3, Download, Globe, Pencil, Save, Search, Users, X } from 'lucide-react'
import type { CrmLead, InboxColumn, LeadStatus, SavedViewVisibility } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import { useBulkPatch, useCrmPrefs, useCrmSettings, useDeleteView, useEnrollWorkflow, useSaveView, useSavedViews, useUpdateCrmPrefs, useUpdateView, useWorkflows,
  useTagLeads,
  useTags,
} from '../api'
import { LostReasonDialog } from '../LostReasonDialog'
import {
  CREATED_RANGES,
  EMPTY_QUERY,
  QUICK_FILTERS,
  STAGES,
  STAGE_LABEL,
  applyQuery,
  type LeadQuery,
  type QuickFilter,
} from '../leads'
import { isSaveable, takeLocalViews, toLeadQuery, toSavedQuery } from '../views'
import { ArchiveDialog } from '../ArchiveDialog'
import { DEFAULT_INBOX_COLUMNS, INBOX_COLUMNS, LeadTable, exportLeadsCsv } from './shared'

const SCOPE_LABEL: Record<SavedViewVisibility, string> = { private: 'Only me', team: 'My team', everyone: 'Everyone' }

export function InboxTab({
  leads,
  now,
  query,
  onQuery,
  counts,
  onOpen,
  showArchived,
  onShowArchived,
  chrome = true,
}: {
  leads: readonly CrmLead[]
  now: Date
  query: LeadQuery
  onQuery: (q: LeadQuery) => void
  counts: Record<QuickFilter, number>
  onOpen: (id: string) => void
  showArchived: boolean
  onShowArchived: (on: boolean) => void
  /** False on the leads page, which shows its own view picker and search. */
  chrome?: boolean
}) {
  const { data: views } = useSavedViews()
  const saveView = useSaveView()
  const updateView = useUpdateView()
  const deleteView = useDeleteView()
  const [naming, setNaming] = useState(false)
  const [viewName, setViewName] = useState('')
  const [viewScope, setViewScope] = useState<SavedViewVisibility>('private')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [losing, setLosing] = useState(false)
  const bulk = useBulkPatch()
  const workflows = useWorkflows()
  const tags = useTags()
  const [askArchive, setAskArchive] = useState(false)
  const tagLeads = useTagLeads()
  const enroll = useEnrollWorkflow()
  const settings = useCrmSettings()
  const { session } = useAuth()
  const access = useAccess()
  const canShare = access.hasAction('crm', 'edit')
  const myId = session?.user_id ?? null

  // Views saved before they lived on the API were in this browser only. Push
  // them up once, so nothing someone set up is lost in the move.
  const migrated = useRef(false)
  useEffect(() => {
    if (migrated.current || !views) return
    migrated.current = true
    for (const v of takeLocalViews()) {
      if (!views.some((s) => s.name === v.name)) saveView.mutate({ name: v.name, query: v.query, visibility: 'private' })
    }
  }, [views, saveView])

  // Personal layout: which columns show, remembered per person on the API.
  const { data: prefs } = useCrmPrefs()
  const updatePrefs = useUpdateCrmPrefs()
  const [showColumns, setShowColumns] = useState(false)
  const columns = prefs?.columns ?? DEFAULT_INBOX_COLUMNS
  const density = prefs?.density ?? 'comfortable'

  function toggleColumn(key: InboxColumn, on: boolean) {
    if (key === 'lead') return
    const next = on ? [...columns, key] : columns.filter((c) => c !== key)
    // Keep the canonical left-to-right order so a toggled column lands where
    // the eye expects it rather than appended at the end.
    const order = INBOX_COLUMNS.map((c) => c.key)
    next.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    updatePrefs.mutate({ columns: next })
  }

  // The default view opens itself on arrival — but only when the person
  // hasn't already filtered; a shared link's filters always win.
  const appliedDefault = useRef(false)
  useEffect(() => {
    if (appliedDefault.current || !prefs?.default_view_id || !views) return
    if (isSaveable(query)) {
      appliedDefault.current = true
      return
    }
    const v = views.find((s) => s.id === prefs.default_view_id)
    if (v) onQuery(toLeadQuery(v.query))
    appliedDefault.current = true
  }, [prefs, views, query, onQuery])

  const rows = useMemo(() => applyQuery(leads, query, now), [leads, query, now])
  // The real team directory, not a scan of who currently has a lead — a
  // newly onboarded rep with zero leads still needs to show up here, both
  // as an owner filter and as a bulk-reassign target.
  const { data: members } = useMembers()
  const assignees = useMemo(
    () => (members ?? []).map((m): [string, string] => [m.user_id, m.name]),
    [members],
  )

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())
  const toggleFilter = (f: QuickFilter) =>
    onQuery({
      ...query,
      filters: query.filters.includes(f) ? query.filters.filter((x) => x !== f) : [...query.filters, f],
    })

  const runBulk = (patch: Parameters<typeof bulk.mutate>[0]['patch']) =>
    bulk.mutate({ ids: [...selected], patch }, { onSuccess: () => setSelected(new Set()) })

  // Every filter, not four of them. A Clear button that fails to appear because
  // the only thing filtering is `quality` is how a studio ends up staring at a
  // short list with no idea why.
  const activeFilters = useMemo(() => {
    const out: Array<{ key: string; label: string; clear: () => void }> = []
    if (query.search)
      out.push({ key: 'search', label: `“${query.search}”`, clear: () => onQuery({ ...query, search: '' }) })
    for (const f of query.filters) {
      const label = QUICK_FILTERS.find((x) => x.value === f)?.label ?? f
      out.push({ key: `f:${f}`, label, clear: () => onQuery({ ...query, filters: query.filters.filter((x) => x !== f) }) })
    }
    if (query.status !== 'all')
      out.push({
        key: 'status',
        label: STAGE_LABEL[query.status] ?? query.status,
        clear: () => onQuery({ ...query, status: 'all' }),
      })
    if (query.assignee !== 'all')
      out.push({
        key: 'assignee',
        label:
          query.assignee === 'none'
            ? 'Unassigned'
            : ((members ?? []).find((m) => m.user_id === query.assignee)?.name ?? 'One owner'),
        clear: () => onQuery({ ...query, assignee: 'all' }),
      })
    if (query.quality !== 'all')
      out.push({ key: 'quality', label: `${query.quality} leads`, clear: () => onQuery({ ...query, quality: 'all' }) })
    if (query.tag !== 'all')
      out.push({
        key: 'tag',
        label: (tags.data ?? []).find((t) => t.id === query.tag)?.name ?? 'One tag',
        clear: () => onQuery({ ...query, tag: 'all' }),
      })
    if (query.created !== 'all')
      out.push({
        key: 'created',
        label: CREATED_RANGES.find((r) => r.value === query.created)?.label ?? query.created,
        clear: () => onQuery({ ...query, created: 'all' }),
      })
    return out
  }, [query, onQuery, members, tags.data])

  const filtered = activeFilters.length > 0

  return (
    <div className="flex flex-col gap-4">
      {/*
        * The page owns the controls now.
        *
        * This block held a how-to banner, a saved-views select, search, a
        * column picker, an archived toggle, seven quick-filter chips and
        * three more selects -- above the first lead, every time. The leads
        * page shows one view name, one search box and one Filter button
        * instead, and passes the rows down. Kept behind a flag rather than
        * deleted because the same component still backs the setup screens,
        * where the full set is what you went there for.
        */}
      {chrome && (
        <>
      {!dismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4 text-sm">
          <p className="flex-1 text-muted-foreground">
            <span className="font-medium text-foreground">Lead Inbox.</span> Stack quick filters to
            narrow the list, save the combinations you use daily, and click a row to open the lead.
          </p>
          <button type="button" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-48"
          value=""
          aria-label="Saved views"
          onChange={(e) => {
            const view = (views ?? []).find((v) => v.id === e.target.value)
            if (view) onQuery(toLeadQuery(view.query))
          }}
        >
          <option value="">Saved views…</option>
          {(views ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>

        {naming ? (
          <span className="flex flex-wrap items-center gap-2">
            <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Name this view" className="w-48" autoFocus aria-label="View name" />
            <Select value={viewScope} onChange={(e) => setViewScope(e.target.value as SavedViewVisibility)} className="w-36" aria-label="Who can see this view">
              <option value="private">Only me</option>
              {canShare && <option value="team">My team</option>}
              {canShare && <option value="everyone">Everyone</option>}
            </Select>
            <Button
              size="sm"
              disabled={!viewName.trim() || saveView.isPending}
              onClick={() =>
                saveView.mutate(
                  { name: viewName.trim(), query: toSavedQuery(query), visibility: viewScope },
                  {
                    onSuccess: () => {
                      setViewName('')
                      setViewScope('private')
                      setNaming(false)
                    },
                  },
                )
              }
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!isSaveable(query)}
            title={isSaveable(query) ? undefined : 'Filter the list first, then save it as a view.'}
            onClick={() => setNaming(true)}
          >
            <BookmarkPlus /> Save current view
          </Button>
        )}

        {(views ?? []).length > 0 && (
          <span className="flex flex-wrap items-center gap-1">
            {(views ?? []).map((v) => {
              const mine = v.user_id === myId
              const canManage = mine || !!session?.is_owner
              const scope = `${SCOPE_LABEL[v.visibility]}${!mine && v.owner_name ? ` · by ${v.owner_name}` : ''}`
              return (
                <span key={v.id} className="flex items-center gap-1 rounded-full border border-border py-1 pl-2.5 pr-1 text-xs" title={scope}>
                  {v.visibility === 'everyone' ? <Globe className="size-3" /> : v.visibility === 'team' ? <Users className="size-3" /> : <Bookmark className="size-3" />}
                  {renamingId === v.id ? (
                    <span className="flex items-center gap-1">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-6 w-32 px-1.5 py-0 text-xs"
                        autoFocus
                        aria-label="View name"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-xs"
                        disabled={!renameValue.trim() || updateView.isPending}
                        onClick={() =>
                          updateView.mutate({ id: v.id, patch: { name: renameValue.trim() } }, { onSuccess: () => setRenamingId(null) })
                        }
                      >
                        Save
                      </Button>
                      <button type="button" onClick={() => setRenamingId(null)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                        <X className="size-3" />
                        <span className="sr-only">Cancel rename</span>
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" onClick={() => onQuery(toLeadQuery(v.query))} className="hover:underline">
                        {v.name}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenameValue(v.name)
                            setRenamingId(v.id)
                          }}
                          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3" />
                          <span className="sr-only">Rename {v.name}</span>
                        </button>
                      )}
                      {canManage && isSaveable(query) && (
                        <button
                          type="button"
                          title={`Save the filters on screen into ${v.name}`}
                          onClick={() => updateView.mutate({ id: v.id, patch: { query: toSavedQuery(query) } })}
                          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <Save className="size-3" />
                          <span className="sr-only">Update {v.name} with the current filters</span>
                        </button>
                      )}
                      {canManage && canShare && (
                        <button
                          type="button"
                          title={`Shared with ${SCOPE_LABEL[v.visibility]} — click to change`}
                          onClick={() =>
                            updateView.mutate({
                              id: v.id,
                              patch: { visibility: v.visibility === 'private' ? 'team' : v.visibility === 'team' ? 'everyone' : 'private' },
                            })
                          }
                          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <Users className="size-3" />
                          <span className="sr-only">Change who can see {v.name}</span>
                        </button>
                      )}
                      {canManage ? (
                        <button type="button" onClick={() => deleteView.mutate(v.id)} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive">
                          <X className="size-3" />
                          <span className="sr-only">Delete {v.name}</span>
                        </button>
                      ) : (
                        <span className="w-1" />
                      )}
                    </>
                  )}
                </span>
              )
            })}
          </span>
        )}

        <span className="relative">
          <Button variant="outline" size="sm" onClick={() => setShowColumns((s) => !s)} aria-expanded={showColumns}>
            <Columns3 /> Columns
          </Button>
          {showColumns && (
            <span className="absolute left-0 top-full z-20 mt-1 flex w-48 flex-col gap-0.5 rounded-lg border border-border bg-card p-2 shadow-lg">
              {INBOX_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={columns.includes(c.key)}
                    disabled={c.key === 'lead'}
                    onChange={(e) => toggleColumn(c.key, e.target.checked)}
                  />
                  {c.label}
                  {c.key === 'lead' && <span className="text-xs text-muted-foreground">(always)</span>}
                </label>
              ))}
              <span className="mt-1 flex items-center gap-2 border-t border-border px-2 pt-2 text-xs text-muted-foreground">
                Density
                <button type="button" onClick={() => updatePrefs.mutate({ density: 'comfortable' })} className={cn('rounded px-1.5 py-0.5', density === 'comfortable' ? 'bg-primary/10 font-medium text-primary' : 'hover:underline')}>
                  Roomy
                </button>
                <button type="button" onClick={() => updatePrefs.mutate({ density: 'compact' })} className={cn('rounded px-1.5 py-0.5', density === 'compact' ? 'bg-primary/10 font-medium text-primary' : 'hover:underline')}>
                  Compact
                </button>
              </span>
            </span>
          )}
        </span>

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div>
        <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Quick filters</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((f) => {
            const on = query.filters.includes(f.value)
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleFilter(f.value)}
                aria-pressed={on}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {f.label}
                <span className="text-xs tabular-nums opacity-70">{counts[f.value]}</span>
              </button>
            )
          })}
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => onQuery(EMPTY_QUERY)}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query.search}
            onChange={(e) => onQuery({ ...query, search: e.target.value })}
            placeholder="Search name, phone, email or notes…"
            className="pl-9"
            aria-label="Search leads"
          />
        </div>
        <Select value={query.status} onChange={(e) => onQuery({ ...query, status: e.target.value as LeadQuery['status'] })} aria-label="Stage">
          <option value="all">All stages</option>
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select value={query.assignee} onChange={(e) => onQuery({ ...query, assignee: e.target.value })} aria-label="Owner">
          <option value="all">Everyone</option>
          <option value="none">Unassigned</option>
          {assignees.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          value={query.quality}
          onChange={(e) => onQuery({ ...query, quality: e.target.value as LeadQuery['quality'] })}
          aria-label="Quality"
        >
          <option value="all">Any quality</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </Select>
        <Select
          value={query.created}
          onChange={(e) => onQuery({ ...query, created: e.target.value as LeadQuery['created'] })}
          aria-label="When the lead arrived"
        >
          {CREATED_RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        {/* The filter group_name never had. */}
        {(tags.data ?? []).length > 0 && (
          <Select
            value={query.tag}
            onChange={(e) => onQuery({ ...query, tag: e.target.value })}
            aria-label="Tag"
          >
            <option value="all">Any tag</option>
            {(tags.data ?? [])
              .filter((t) => t.is_active || t.id === query.tag)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.lead_count > 0 ? ` (${t.lead_count})` : ''}
                </option>
              ))}
          </Select>
        )}
      </div>

        </>
      )}

      {/*
        * What is currently narrowing this list, whether or not the panel that
        * set it is open. The filter controls collapse behind one button now, so
        * without this a studio can be looking at eleven leads out of four
        * hundred with nothing on screen saying why.
        */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Showing only:</span>
          {activeFilters.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs"
            >
              {f.label}
              <button
                type="button"
                onClick={f.clear}
                className="-mr-0.5 rounded-full px-0.5 leading-none text-muted-foreground hover:text-foreground"
              >
                ×<span className="sr-only">Remove this filter</span>
              </button>
            </span>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onQuery(EMPTY_QUERY)}>
            Clear all
          </Button>
        </div>
      )}

      <ArchiveDialog
        open={askArchive}
        count={selected.size}
        pending={bulk.isPending}
        onCancel={() => setAskArchive(false)}
        onConfirm={(reason) => {
          runBulk(reason === null ? { is_archived: true } : { is_archived: true, archive_reason: reason })
          setAskArchive(false)
        }}
      />

      {selected.size > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2" role="toolbar" aria-label="Bulk actions">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select
            value=""
            aria-label="Move to stage"
            onChange={(e) => {
              const v = e.target.value as LeadStatus | ''
              // Lost needs its reason up front — the API refuses it without
              // one, so ask here instead of failing the whole batch after.
              if (v === 'lost') setLosing(true)
              else if (v) runBulk({ status: v })
            }}
            className="w-36"
          >
            <option value="">Move to…</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select
            value=""
            aria-label="Assign to"
            onChange={(e) => {
              const v = e.target.value
              if (v === 'none') runBulk({ assigned_to: null })
              else if (v) runBulk({ assigned_to: v })
            }}
            className="w-40"
          >
            <option value="">Assign to…</option>
            <option value="none">Unassigned</option>
            {assignees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => runBulk({ is_hot: true })}>
            Mark hot
          </Button>
          <Select
            value=""
            aria-label="Set the follow-up"
            className="w-40"
            onChange={(e) => {
              const days = e.target.value
              if (!days) return
              if (days === 'clear') return runBulk({ follow_up_at: null })
              const at = new Date()
              at.setDate(at.getDate() + Number(days))
              at.setHours(10, 0, 0, 0)
              runBulk({ follow_up_at: at.toISOString() })
            }}
          >
            <option value="">Follow up…</option>
            <option value="0">Today</option>
            <option value="1">Tomorrow</option>
            <option value="3">In 3 days</option>
            <option value="7">Next week</option>
            <option value="clear">Clear the date</option>
          </Select>
          {(workflows.data ?? []).some((w) => w.is_active) && (
            <Select
              value=""
              aria-label="Enroll in workflow"
              onChange={(e) => {
                if (e.target.value) enroll.mutate({ workflowId: e.target.value, lead_ids: [...selected] }, { onSuccess: () => setSelected(new Set()) })
              }}
              className="w-44"
            >
              <option value="">Enroll in…</option>
              {(workflows.data ?? []).filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
          {/* Both directions in one control: the studio that can label forty
              leads at once is the studio that mislabels forty at once. */}
          {(tags.data ?? []).filter((t) => t.is_active).length > 0 && (
            <Select
              value=""
              aria-label="Tag the selected leads"
              className="w-44"
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                const attach = !v.startsWith('-')
                tagLeads.mutate(
                  { ids: [...selected], tag_id: attach ? v : v.slice(1), attach },
                  { onSuccess: () => setSelected(new Set()) },
                )
              }}
            >
              <option value="">Tag…</option>
              {(tags.data ?? [])
                .filter((t) => t.is_active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    Add {t.name}
                  </option>
                ))}
              {(tags.data ?? [])
                .filter((t) => t.is_active)
                .map((t) => (
                  <option key={`off-${t.id}`} value={`-${t.id}`}>
                    Remove {t.name}
                  </option>
                ))}
            </Select>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={bulk.isPending}
            onClick={() => (showArchived ? runBulk({ is_archived: false }) : setAskArchive(true))}
          >
            {showArchived ? 'Restore' : 'Archive'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {/* Downloading the client book is not the same act as reading a page
              of it, and the permission registry has always said so: crm_export
              is sensitive and off for every staff role by default. Nothing read
              it until now, so any employee who could open this screen could
              take the lot. */}
          {access.hasModule('crm_export') && (
            <Button size="sm" variant="outline" onClick={() => exportLeadsCsv(rows.filter((r) => selected.has(r.id)))}>
              <Download /> CSV
            </Button>
          )}
        </div>
      )}

      {leads.length >= 2000 && (
        <p className="text-xs text-muted-foreground">
          Showing the {leads.length.toLocaleString('en-IN')} most recent leads. Older ones are still in reports and on a contact.
        </p>
      )}
      <LeadTable leads={rows} now={now} total={leads.length} onOpen={onOpen} selected={selected} onToggleSelect={toggleSelect} onToggleAll={toggleAll} hotScore={settings.data?.hot_score ?? 60} columns={columns} density={density} />

      <LostReasonDialog
        open={losing}
        count={selected.size}
        pending={bulk.isPending}
        onCancel={() => setLosing(false)}
        onConfirm={(d) => {
          setLosing(false)
          runBulk({ status: 'lost', ...d })
        }}
      />
    </div>
  )
}
