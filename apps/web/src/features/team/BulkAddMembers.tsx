import { useMemo, useState, type ReactNode } from 'react'
import { Check, ClipboardPaste, Eye, EyeOff, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useFormDraft, DraftRestoredBanner } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { ToneChip, TONE_DOT, TONE_TEXT } from '@/shared/ui/tone-chip'
import { useBulkTeamCalls, useEmployeeRoles, useRoleLibrary } from './api'
import { STAGE_LABEL, STAGE_ORDER, STAGE_TONE } from './role-stages'
import {
  DEFAULT_PASTE_COLUMNS,
  isBlankRow,
  isLibraryKey,
  newRow,
  parsePastedTeam,
  pendingRows,
  pickableRoles,
  toRequest,
  validateRows,
  type BulkRow,
  type PickableRole,
  type RowField,
} from './bulk'
import { ROLE_LABEL, useTeamPowers } from './powers'

const START_ROWS = 3
/** Members sent at once. Small enough to be gentle on the API, big enough that forty people is not a long wait. */
const CONCURRENCY = 3

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Add many people in one table.
 *
 * The single-member wizard asks six questions per person, which is right for
 * someone whose pay and access need thinking about and wrong for typing in a
 * crew of twelve. Here everyone is one row: type them, or paste them straight
 * out of the spreadsheet the studio already keeps, then send them all at once.
 *
 * Rows are sent one by one and each reports its own result, rather than as
 * one all-or-nothing batch: a typo in row 7 should cost row 7, not the other
 * eleven. Whatever went through is locked and ticked; whatever didn't stays
 * editable with the reason beside it, and the button retries only those.
 */
export function BulkAddMembers({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { data: roles } = useEmployeeRoles()
  const { data: library } = useRoleLibrary()
  const calls = useBulkTeamCalls()

  const [rows, setRows] = useState<BulkRow[]>(() => Array.from({ length: START_ROWS }, newRow))
  const [showErrors, setShowErrors] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [sharedPassword, setSharedPassword] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [unknownRoles, setUnknownRoles] = useState<string[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)

  // What was typed survives a refresh or a closed tab until it is saved. Only
  // rows still to send are kept, and never their passwords (nor the paste box,
  // which can hold them): those are typed again.
  const typedRows = rows
    .filter((r) => r.status !== 'added' && !isBlankRow(r))
    .map(({ name, phone, email, role, engagement, roleKeys }) => ({ name, phone, email, role, engagement, roleKeys }))
  const draft = useFormDraft('team-bulk-add', typedRows, (v) => setRows(v.map((r) => ({ ...newRow(), ...r }))))

  // Library roles the studio has not added yet would be created on send --
  // which only the owner may do, so anyone else picks from the studio's own.
  const { canAddJobRoles } = useTeamPowers()
  const pickable = useMemo(
    () => pickableRoles(roles ?? [], canAddJobRoles ? (library ?? []) : []),
    [roles, library, canAddJobRoles],
  )
  const roleName = useMemo(() => new Map(pickable.map((r) => [r.key, r.type_name])), [pickable])
  const errors = useMemo(() => validateRows(rows), [rows])
  const todo = pendingRows(rows)
  const retrying = todo.some((r) => r.status === 'failed')

  const patch = (key: string, next: Partial<BulkRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)))

  const edit = (key: string, next: Partial<BulkRow>) => {
    // Editing a refused row is the act of fixing it: it goes back to draft and
    // the server's old reason stops showing against the new value.
    patch(key, { ...next, status: 'draft', error: null })
  }

  const removeRow = (key: string) =>
    setRows((prev) => {
      const next = prev.filter((r) => r.key !== key)
      return next.length > 0 ? next : [newRow()]
    })

  function applyPaste() {
    const parsed = parsePastedTeam(pasteText, pickable)
    if (parsed.rows.length === 0) {
      toast.error('Nothing to add — paste at least one row with a name in it.')
      return
    }
    // Pasted rows replace the untouched blanks rather than landing under them.
    setRows((prev) => [...prev.filter((r) => !isBlankRow(r)), ...parsed.rows])
    setUnknownRoles(parsed.unknownRoles)
    setPasteText('')
    setPasteOpen(false)
    setShowErrors(false)
    toast.success(`${plural(parsed.rows.length, 'person', 'people')} added to the table.`)
  }

  function applySharedPassword() {
    if (sharedPassword.length < 6) {
      toast.error('Use at least 6 characters.')
      return
    }
    setRows((prev) => prev.map((r) => (r.status === 'added' ? r : { ...r, password: sharedPassword })))
    toast.success('Password set on every row. Each person can change it after signing in.')
  }

  async function submit() {
    if (todo.length === 0) {
      toast.error('Type at least one person first.')
      return
    }
    if (errors.size > 0) {
      setShowErrors(true)
      toast.error(`${plural(errors.size, 'row')} need${errors.size === 1 ? 's' : ''} fixing first — see the red fields.`)
      return
    }

    setRunning(true)
    setProgress(0)

    // Library roles are created once each, before anyone who uses them is
    // sent, so two rows asking for "Video Editor" share one role rather than
    // racing to create two.
    const resolved = new Map<string, string>()
    for (const p of pickable) if (p.owned) resolved.set(p.key, p.key)
    const needed = [...new Set(todo.flatMap((r) => r.roleKeys).filter(isLibraryKey))]
    const roleFailures: string[] = []
    for (const key of needed) {
      const p = pickable.find((x) => x.key === key)
      if (!p) continue
      try {
        const made = await calls.createRole({ type_name: p.type_name, role_code: p.role_code, stage: p.stage })
        resolved.set(key, made.id)
      } catch {
        // The person still gets added; only this one role is missing from
        // them, and it is named in the summary below.
        roleFailures.push(p.type_name)
      }
    }

    let added = 0
    let linked = 0
    let failed = 0
    let done = 0
    const queue = [...todo]
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const row = r
        patch(row.key, { status: 'saving', error: null })
        try {
          const out = await calls.addMember(toRequest(row, (k) => resolved.get(k) ?? null))
          patch(row.key, { status: 'added' })
          added++
          if (out.linked_existing_login) linked++
        } catch (err) {
          patch(row.key, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'We could not add this person.',
          })
          failed++
        } finally {
          setProgress(++done)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
    await calls.refresh()
    setRunning(false)

    if (roleFailures.length > 0) {
      toast.error(`Couldn't create: ${roleFailures.join(', ')}. You can add these roles from each person's Edit.`)
    }
    // People who already use IPC for another studio were linked to that login
    // rather than given the password from this table -- say so, or the owner
    // hands out a password that does not work for them.
    if (linked > 0) {
      toast.info(
        `${plural(linked, 'person', 'people')} already use${linked === 1 ? 's' : ''} IPC with another studio, so they sign in with their own password and switch to yours.`,
        { duration: 10_000 },
      )
    }
    if (failed === 0) {
      toast.success(`${plural(added, 'person', 'people')} added to your team.`)
      draft.clear()
      onDone()
      return
    }
    toast.error(
      `${added > 0 ? `${added} added. ` : ''}${plural(failed, 'row')} couldn't be added — the reason is on each red row.`,
    )
  }

  const pickingRow = rows.find((r) => r.key === picking) ?? null

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Add several people at once</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One row per person. Leave email blank for anyone who won&apos;t sign in — they can still be booked on shoots.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel} disabled={running}>
          Cancel
        </Button>
      </div>

      {draft.restoredAt && (
        <div className="mt-4">
          <DraftRestoredBanner
            at={draft.restoredAt}
            onDismiss={draft.dismissRestored}
            onDiscard={() => {
              draft.clear()
              setRows(Array.from({ length: START_ROWS }, newRow))
              setShowErrors(false)
            }}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setPasteOpen((v) => !v)} disabled={running}>
          <ClipboardPaste /> Paste from a spreadsheet
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowPasswords((v) => !v)}>
          {showPasswords ? <EyeOff /> : <Eye />}
          {showPasswords ? 'Hide passwords' : 'Show passwords'}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="bulk-shared-password" className="text-sm text-muted-foreground">
            Same password for everyone
          </label>
          <Input
            id="bulk-shared-password"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            value={sharedPassword}
            onChange={(e) => setSharedPassword(e.target.value)}
            placeholder="6+ characters"
            className="h-8 w-40"
            disabled={running}
          />
          <Button variant="outline" size="sm" onClick={applySharedPassword} disabled={running || !sharedPassword}>
            Apply
          </Button>
        </div>
      </div>

      {pasteOpen && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">Copy the rows out of Excel or Google Sheets and paste them here.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Columns in this order: {DEFAULT_PASTE_COLUMNS.join(' · ')}. Or include your own header row — any order works.
            Several job roles go in one cell, separated by commas.
          </p>
          <Textarea
            className="mt-2 font-mono text-sm"
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Asha Rao\t9876543210\tasha@studio.in\tWelcome@123\tCandid Photographer'}
            aria-label="Pasted team rows"
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>
              Add these rows
            </Button>
          </div>
        </div>
      )}

      {unknownRoles.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          We didn&apos;t recognise these job roles, so they were left off: <strong>{unknownRoles.join(', ')}</strong>.
          Pick the closest one on each row, or create them under Roles &amp; Access.
          <button type="button" className="ml-2 underline" onClick={() => setUnknownRoles([])}>
            Dismiss
          </button>
        </p>
      )}

      <div className="table-wrap mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 text-center font-medium">#</th>
              <th className="min-w-40 px-2 py-2 font-medium">Name *</th>
              <th className="min-w-36 px-2 py-2 font-medium">Phone *</th>
              <th className="min-w-48 px-2 py-2 font-medium">Email</th>
              <th className="min-w-36 px-2 py-2 font-medium">Password</th>
              <th className="min-w-40 px-2 py-2 font-medium">Job roles</th>
              <th className="min-w-28 px-2 py-2 font-medium">Access</th>
              <th className="min-w-28 px-2 py-2 font-medium">Type</th>
              <th className="w-20 px-2 py-2">
                <span className="sr-only">Row status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Row
                key={r.key}
                index={i}
                row={r}
                errors={showErrors ? errors.get(r.key) : undefined}
                locked={running || r.status === 'added'}
                showPasswords={showPasswords}
                roleName={roleName}
                onEdit={(next) => edit(r.key, next)}
                onPickRoles={() => setPicking(r.key)}
                onRemove={() => removeRow(r.key)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, newRow()])} disabled={running}>
          <Plus /> Add row
        </Button>
        <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {running
            ? `Adding ${progress} of ${todo.length}…`
            : todo.length === 0
              ? 'Nobody typed in yet'
              : `${plural(todo.length, 'person', 'people')} ready`}
        </p>
        <Button onClick={() => void submit()} disabled={running || todo.length === 0}>
          {running ? <Loader2 className="animate-spin" /> : <Check />}
          {retrying ? `Retry ${plural(todo.length, 'person', 'people')}` : `Add ${plural(todo.length, 'person', 'people')}`}
        </Button>
      </div>

      <RolePicker
        row={pickingRow}
        pickable={pickable}
        onClose={() => setPicking(null)}
        onChange={(roleKeys) => pickingRow && edit(pickingRow.key, { roleKeys })}
        onApplyToAll={(roleKeys) =>
          setRows((prev) => prev.map((r) => (r.status === 'added' ? r : { ...r, roleKeys, status: 'draft', error: null })))
        }
      />
    </div>
  )
}

function Row({
  index,
  row,
  errors,
  locked,
  showPasswords,
  roleName,
  onEdit,
  onPickRoles,
  onRemove,
}: {
  index: number
  row: BulkRow
  errors: Partial<Record<RowField, string>> | undefined
  locked: boolean
  showPasswords: boolean
  roleName: Map<string, string>
  onEdit: (next: Partial<BulkRow>) => void
  onPickRoles: () => void
  onRemove: () => void
}) {
  const powers = useTeamPowers()
  const noLogin = !row.email.trim()
  const names = row.roleKeys.map((k) => roleName.get(k)).filter(Boolean) as string[]

  const cell = (field: RowField, input: ReactNode) => (
    <td className="px-2 py-1.5 align-top">
      {input}
      {errors?.[field] && <p className="mt-0.5 text-xs text-destructive">{errors[field]}</p>}
    </td>
  )

  return (
    <>
      <tr
        className={cn(
          'border-t border-border',
          row.status === 'added' && 'bg-success/5',
          row.status === 'failed' && 'bg-destructive/5',
        )}
      >
        <td className="px-2 py-1.5 text-center align-top text-xs leading-8 text-muted-foreground">{index + 1}</td>
        {cell(
          'name',
          <Input
            className="h-8"
            value={row.name}
            onChange={(e) => onEdit({ name: e.target.value })}
            placeholder="Full name"
            aria-label={`Row ${index + 1} name`}
            aria-invalid={!!errors?.name}
            disabled={locked}
          />,
        )}
        {cell(
          'phone',
          <Input
            className="h-8"
            inputMode="tel"
            value={row.phone}
            onChange={(e) => onEdit({ phone: e.target.value })}
            placeholder="Mobile"
            aria-label={`Row ${index + 1} phone`}
            aria-invalid={!!errors?.phone}
            disabled={locked}
          />,
        )}
        {cell(
          'email',
          <Input
            className="h-8"
            type="email"
            value={row.email}
            onChange={(e) => onEdit({ email: e.target.value })}
            placeholder="Blank = no login"
            aria-label={`Row ${index + 1} email`}
            aria-invalid={!!errors?.email}
            disabled={locked}
          />,
        )}
        {cell(
          'password',
          <Input
            className="h-8"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            value={noLogin ? '' : row.password}
            onChange={(e) => onEdit({ password: e.target.value })}
            placeholder={noLogin ? 'Not needed' : '6+ characters'}
            aria-label={`Row ${index + 1} password`}
            aria-invalid={!!errors?.password}
            disabled={locked || noLogin}
          />,
        )}
        <td className="px-2 py-1.5 align-top">
          <button
            type="button"
            onClick={onPickRoles}
            disabled={locked}
            className="flex h-8 w-full items-center truncate rounded-md border border-input bg-card px-2.5 text-left text-sm shadow-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Row ${index + 1} job roles`}
          >
            {names.length === 0 ? (
              <span className="text-muted-foreground">Pick…</span>
            ) : (
              <span className="truncate">
                {names[0]}
                {names.length > 1 && <span className="text-muted-foreground"> +{names.length - 1}</span>}
              </span>
            )}
          </button>
        </td>
        <td className="px-2 py-1.5 align-top">
          <Select
            className="h-8"
            value={row.role}
            onChange={(e) => onEdit({ role: e.target.value as BulkRow['role'] })}
            aria-label={`Row ${index + 1} access`}
            disabled={locked}
          >
            {(['employee', 'manager', 'admin'] as const)
                    .filter((r) => powers.mayGrant(r) || r === row.role)
                    .map((r) => (
                      <option key={r} value={r} disabled={!powers.mayGrant(r)}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
          </Select>
        </td>
        <td className="px-2 py-1.5 align-top">
          <Select
            className="h-8"
            value={row.engagement}
            onChange={(e) => onEdit({ engagement: e.target.value as BulkRow['engagement'] })}
            aria-label={`Row ${index + 1} type`}
            disabled={locked}
          >
            <option value="in_house">In-house</option>
            <option value="freelancer">Freelancer</option>
          </Select>
        </td>
        <td className="px-2 py-1.5 text-right align-top">
          {row.status === 'added' ? (
            <span className="inline-flex h-8 items-center gap-1 text-xs font-medium text-success">
              <Check className="size-3.5" /> Added
            </span>
          ) : row.status === 'saving' ? (
            <span className="inline-flex h-8 items-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="sr-only">Adding</span>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRemove}
              disabled={locked}
              title="Remove this row"
            >
              <X />
              <span className="sr-only">Remove row {index + 1}</span>
            </Button>
          )}
        </td>
      </tr>
      {row.status === 'failed' && row.error && (
        <tr className="bg-destructive/5">
          <td />
          <td colSpan={8} className="px-2 pb-2 text-xs text-destructive">
            {row.error}
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * The job roles for one row. Library defaults appear alongside the studio's
 * own roles and are created on send, the same single list the wizard offers.
 * "Use for every row" exists because a crew is usually one or two jobs
 * repeated — twelve candid photographers should be one click, not twelve.
 */
function RolePicker({
  row,
  pickable,
  onClose,
  onChange,
  onApplyToAll,
}: {
  row: BulkRow | null
  pickable: readonly PickableRole[]
  onClose: () => void
  onChange: (roleKeys: string[]) => void
  onApplyToAll: (roleKeys: string[]) => void
}) {
  const chosen = row?.roleKeys ?? []
  const toggle = (key: string) =>
    onChange(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key])

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title={row?.name.trim() ? `Job roles for ${row.name.trim()}` : 'Job roles'}
        description="What they get booked for. Pick as many as apply."
      >
        {pickable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No job roles yet. You can add them under Roles &amp; Access and assign them later.
          </p>
        ) : (
          // Grouped by when in the job the role works — the same grouping and
          // colours as the roles page and the shoot requirement picker.
          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
            {STAGE_ORDER.map((stage) => {
              const inStage = pickable.filter((p) => p.stage === stage)
              if (inStage.length === 0) return null
              const tone = STAGE_TONE[stage]
              return (
                <div key={stage}>
                  <p className={cn('mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', TONE_TEXT[tone])}>
                    <span className={cn('size-2 rounded-full', TONE_DOT[tone])} aria-hidden />
                    {STAGE_LABEL[stage]}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {inStage.map((p) => (
                      <ToneChip
                        key={p.key}
                        tone={tone}
                        label={p.type_name}
                        selected={chosen.includes(p.key)}
                        onClick={() => toggle(p.key)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onApplyToAll(chosen)
              toast.success('Job roles set on every row.')
              onClose()
            }}
            disabled={chosen.length === 0}
          >
            Use for every row
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
