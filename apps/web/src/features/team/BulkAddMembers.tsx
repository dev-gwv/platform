import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Check, ChevronDown, ClipboardPaste, Eye, EyeOff, Loader2, Plus, X } from 'lucide-react'
import type { ProductionStage } from '@ipc/contracts'
import { toast } from 'sonner'
import { useLearn } from '@/features/help/LearnCard'
import { useFormDraft, DraftRestoredBanner } from '@/shared/hooks/use-form-draft'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { TONE_CHIP_STATIC } from '@/shared/ui/tone-chip'
import { useBulkTeamCalls, useEmployeeRoles, useRoleLibrary } from './api'
import { JobRolePicker } from './JobRolePicker'
import { STAGE_TONE, toRoleCode } from './role-stages'
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
import { CAN_SEE_LABEL, WORKS_AS_LABEL, useTeamPowers } from './powers'

const START_ROWS = 3
/** Members sent at once. Small enough to be gentle on the API, big enough that forty people is not a long wait. */
const CONCURRENCY = 3

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Add many people in one table.
 *
 * "Add one person" is a minute per person, which is right for a two-person
 * studio and wrong for typing in a crew of twelve. Here everyone is one row:
 * type them, or paste them straight out of the spreadsheet the studio already
 * keeps, then send them all at once.
 *
 * Rows are sent one by one and each reports its own result, rather than as
 * one all-or-nothing batch: a typo in row 7 should cost row 7, not the other
 * eleven. Whatever went through is locked and ticked; whatever didn't stays
 * editable with the reason beside it, and the button retries only those.
 */
export function BulkAddMembers({ onDone, onCancel }: { onDone: (added: number) => void; onCancel: () => void }) {
  const { data: roles } = useEmployeeRoles()
  const { data: library } = useRoleLibrary()
  const calls = useBulkTeamCalls()
  const learn = useLearn('team-bulk', { countClose: true })
  // In setup the table is only who they are: access and in-house/freelance
  // keep their defaults, and the extras wait behind "More options".
  const { search } = useLocation()
  const setup = (search as Record<string, unknown>).from === 'setup'
  const onPhone = useIsMobile()
  const [moreOpen, setMoreOpen] = useState(false)
  const showExtras = !setup || moreOpen
  const tableRef = useRef<HTMLDivElement>(null)

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
    .map(({ name, phone, login, email, role, engagement, roleKeys }) => ({ name, phone, login, email, role, engagement, roleKeys }))
  // A draft from before the tick existed: an email meant a login then.
  const draft = useFormDraft('team-bulk-add', typedRows, (v) =>
    setRows(v.map((r) => ({ ...newRow(), ...r, login: (r as { login?: boolean }).login ?? !!r.email.trim() }))),
  )

  // Library roles the studio has not added yet would be created on send --
  // which only the owner may do, so anyone else picks from the studio's own.
  const { canAddJobRoles } = useTeamPowers()
  const pickable = useMemo(
    () => pickableRoles(roles ?? [], canAddJobRoles ? (library ?? []) : []),
    [roles, library, canAddJobRoles],
  )
  const roleByKey = useMemo(() => new Map(pickable.map((r) => [r.key, r])), [pickable])
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
    if (sharedPassword.length < 8) {
      toast.error('Use at least 8 characters.')
      return
    }
    setRows((prev) => prev.map((r) => (r.status === 'added' ? r : { ...r, password: sharedPassword })))
    toast.success('Password set on every row. Each person can change it after signing in.')
  }

  async function submit() {
    if (todo.length === 0) {
      toast.error('Type at least one person first.')
      learn.refused()
      return
    }
    if (errors.size > 0) {
      setShowErrors(true)
      learn.refused()
      toast.error(`${plural(errors.size, 'person needs', 'people need')} fixing first — the first one is picked for you.`)
      // Take them to the first field to fix, so a phone never hides it.
      requestAnimationFrame(() => {
        const bad = tableRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        if (!bad) return
        bad.scrollIntoView({ block: 'center', behavior: 'smooth' })
        bad.focus({ preventScroll: true })
      })
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
      learn.progress()
      toast.success(`${plural(added, 'person', 'people')} added.`)
      draft.clear()
      onDone(added)
      return
    }
    toast.error(
      `${added > 0 ? `${added} added. ` : ''}${plural(failed, 'row')} couldn't be added — the reason is on each red row.`,
    )
  }

  const pickingRow = rows.find((r) => r.key === picking) ?? null
  const rowProps = (r: BulkRow, i: number): RowProps => ({
    index: i,
    row: r,
    errors: showErrors ? errors.get(r.key) : undefined,
    locked: running || r.status === 'added',
    showPasswords,
    roleByKey,
    onEdit: (next: Partial<BulkRow>) => edit(r.key, next),
    onPickRoles: () => setPicking(r.key),
    onRemove: () => removeRow(r.key),
  })

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Bulk add team</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One {onPhone ? 'card' : 'row'} per person. Tick <strong className="font-medium text-foreground">Give a login</strong> only for
            whoever will sign in — everyone can still be booked on shoots.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel} disabled={running}>
          Cancel
        </Button>
      </div>

      {learn.card && <div className="mt-4 max-w-2xl">{learn.card}</div>}

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

      {setup && (
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          More options
          <ChevronDown className={cn('size-4 transition-transform', moreOpen && 'rotate-180')} aria-hidden />
        </button>
      )}

      {showExtras && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPasteOpen((v) => !v)} disabled={running}>
            <ClipboardPaste /> Paste from a spreadsheet
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPasswords((v) => !v)}>
            {showPasswords ? <EyeOff /> : <Eye />}
            {showPasswords ? 'Hide passwords' : 'Show passwords'}
          </Button>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <label htmlFor="bulk-shared-password" className="text-sm text-muted-foreground">
              Same password for everyone
            </label>
            <Input
              id="bulk-shared-password"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              value={sharedPassword}
              onChange={(e) => setSharedPassword(e.target.value)}
              placeholder="8+ characters"
              className="h-8 w-40"
              disabled={running}
            />
            <Button variant="outline" size="sm" onClick={applySharedPassword} disabled={running || !sharedPassword}>
              Apply
            </Button>
          </div>
        </div>
      )}

      {pasteOpen && showExtras && (
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
          Open Job roles on each row and type the name to add it as a new role.
          <button type="button" className="ml-2 underline" onClick={() => setUnknownRoles([])}>
            Dismiss
          </button>
        </p>
      )}

      <div ref={tableRef}>
        {onPhone ? (
          <ol className="mt-3 flex flex-col gap-3">
            {rows.map((r, i) => (
              <PersonCard key={r.key} {...rowProps(r, i)} />
            ))}
          </ol>
        ) : (
          <div className="table-wrap mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2 text-center font-medium">#</th>
                  <th className="min-w-40 px-2 py-2 font-medium">Name *</th>
                  <th className="min-w-36 px-2 py-2 font-medium">Mobile *</th>
                  <th className="min-w-56 px-2 py-2 font-medium">Give a login?</th>
                  <th className="min-w-40 px-2 py-2 font-medium">Job roles</th>
                  {!setup && <th className="min-w-32 px-2 py-2 font-medium">Can see</th>}
                  {!setup && <th className="min-w-28 px-2 py-2 font-medium">Works as</th>}
                  <th className="w-20 px-2 py-2">
                    <span className="sr-only">Row status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Row key={r.key} {...rowProps(r, i)} simple={setup} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, newRow()])} disabled={running}>
          <Plus /> {onPhone ? 'Add another person' : 'Add row'}
        </Button>
      </div>

      {/* Sticky, so the button is in reach on a phone; the help bubble keeps its lane clear of it. */}
      <div
        data-sticky-actions
        className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 pl-1 backdrop-blur"
      >
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {running
            ? `Adding ${progress} of ${todo.length}…`
            : todo.length === 0
              ? 'Nobody typed in yet'
              : `${plural(todo.length, 'person', 'people')} ready`}
        </p>
        <Button className="ml-auto" onClick={() => void submit()} disabled={running || todo.length === 0}>
          {running ? <Loader2 className="animate-spin" /> : <Check />}
          {retrying ? `Retry ${plural(todo.length, 'person', 'people')}` : `Add ${plural(todo.length, 'person', 'people')}`}
        </Button>
      </div>

      <RolePicker
        row={pickingRow}
        pickable={pickable}
        onCreate={
          canAddJobRoles
            ? async (name, stage) => {
                const made = await calls.createRole({ type_name: name, role_code: toRoleCode(name), stage })
                await calls.refresh()
                return made.id
              }
            : undefined
        }
        onClose={() => setPicking(null)}
        onChange={(roleKeys) => pickingRow && edit(pickingRow.key, { roleKeys })}
        onApplyToAll={(roleKeys) =>
          setRows((prev) => prev.map((r) => (r.status === 'added' ? r : { ...r, roleKeys, status: 'draft', error: null })))
        }
      />
    </div>
  )
}

interface RowProps {
  index: number
  row: BulkRow
  errors: Partial<Record<RowField, string>> | undefined
  locked: boolean
  showPasswords: boolean
  roleByKey: Map<string, PickableRole>
  onEdit: (next: Partial<BulkRow>) => void
  onPickRoles: () => void
  onRemove: () => void
}

const FieldError = ({ msg }: { msg: string | undefined }) => (msg ? <p className="mt-0.5 text-xs text-destructive">{msg}</p> : null)

/**
 * "Give a login?" then, only when ticked, the email (their username) and the
 * password -- so typing an email is never a surprise "password needed".
 */
function LoginFields({ index, row, errors, locked, showPasswords, onEdit }: RowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="inline-flex min-h-8 cursor-pointer flex-wrap items-center gap-x-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={row.login}
          onChange={(e) => onEdit({ login: e.target.checked })}
          disabled={locked}
          aria-label={`Row ${index + 1} give a login`}
        />
        Give a login
        {!row.login && <span className="text-xs text-muted-foreground">· no sign-in, still bookable</span>}
      </label>
      {row.login && (
        <>
          <div>
            <Input
              className="h-8"
              type="email"
              value={row.email}
              onChange={(e) => onEdit({ email: e.target.value })}
              placeholder="Email (their username)"
              aria-label={`Row ${index + 1} email`}
              aria-invalid={!!errors?.email}
              disabled={locked}
            />
            <FieldError msg={errors?.email} />
          </div>
          <div>
            <Input
              className="h-8"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              value={row.password}
              onChange={(e) => onEdit({ password: e.target.value })}
              placeholder="Password, 8+ characters"
              aria-label={`Row ${index + 1} password`}
              aria-invalid={!!errors?.password}
              disabled={locked}
            />
            <FieldError msg={errors?.password} />
          </div>
        </>
      )}
    </div>
  )
}

function JobRolesButton({ index, row, locked, roleByKey, onPickRoles }: RowProps) {
  const picked = row.roleKeys.map((k) => roleByKey.get(k)).filter((r): r is PickableRole => !!r)
  return (
    /* A box you can see: amber and dashed until a role is picked, then the role in its stage colour. */
    <button
      type="button"
      onClick={onPickRoles}
      disabled={locked}
      className={cn(
        'flex h-8 w-full items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        picked.length === 0
          ? 'border-dashed border-tone-amber/70 bg-tone-amber-soft/40 font-medium text-tone-amber hover:border-tone-amber'
          : 'border-input bg-card hover:border-primary/40',
      )}
      aria-label={`Row ${index + 1} job roles`}
    >
      {picked.length === 0 ? (
        <span className="flex items-center gap-1 px-1">
          <Plus className="size-3.5" aria-hidden /> Job roles
        </span>
      ) : (
        <>
          <span className={cn('min-w-0 truncate rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CHIP_STATIC[STAGE_TONE[picked[0]!.stage]])}>
            {picked[0]!.type_name}
          </span>
          {picked.length > 1 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">+{picked.length - 1}</span>
          )}
        </>
      )}
    </button>
  )
}

function RowStatus({ index, row, locked, onRemove }: RowProps) {
  if (row.status === 'added') {
    return (
      <span className="inline-flex h-8 items-center gap-1 text-xs font-medium text-success">
        <Check className="size-3.5" /> Added
      </span>
    )
  }
  if (row.status === 'saving') {
    return (
      <span className="inline-flex h-8 items-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="sr-only">Adding</span>
      </span>
    )
  }
  return (
    <Button size="sm" variant="ghost" onClick={onRemove} disabled={locked} title="Remove this person">
      <X />
      <span className="sr-only">Remove row {index + 1}</span>
    </Button>
  )
}

function NameInput({ index, row, errors, locked, onEdit }: RowProps) {
  return (
    <>
      <Input
        className="h-8"
        value={row.name}
        onChange={(e) => onEdit({ name: e.target.value })}
        placeholder="Full name"
        aria-label={`Row ${index + 1} name`}
        aria-invalid={!!errors?.name}
        disabled={locked}
      />
      <FieldError msg={errors?.name} />
    </>
  )
}

function PhoneInput({ index, row, errors, locked, onEdit }: RowProps) {
  return (
    <>
      <Input
        className="h-8"
        inputMode="tel"
        value={row.phone}
        onChange={(e) => onEdit({ phone: e.target.value })}
        placeholder="Mobile"
        aria-label={`Row ${index + 1} phone`}
        aria-invalid={!!errors?.phone}
        disabled={locked}
      />
      <FieldError msg={errors?.phone} />
    </>
  )
}

/** A phone: one card per person instead of a table that scrolls sideways. */
function PersonCard(props: RowProps) {
  const { index, row } = props
  return (
    <li
      className={cn(
        'rounded-xl border border-border bg-card p-3',
        row.status === 'added' && 'border-success/40 bg-success/5',
        row.status === 'failed' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Person {index + 1}</span>
        <RowStatus {...props} />
      </div>
      <div className="mt-1 flex flex-col gap-2">
        <div>
          <NameInput {...props} />
        </div>
        <div>
          <PhoneInput {...props} />
        </div>
        <JobRolesButton {...props} />
        <LoginFields {...props} />
      </div>
      {row.status === 'failed' && row.error && <p className="mt-2 text-xs text-destructive">{row.error}</p>}
    </li>
  )
}

function Row(props: RowProps & { simple: boolean }) {
  const { index, row, locked, onEdit, simple } = props
  const powers = useTeamPowers()

  const cell = (input: ReactNode) => <td className="px-2 py-1.5 align-top">{input}</td>

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
        {cell(<NameInput {...props} />)}
        {cell(<PhoneInput {...props} />)}
        {cell(<LoginFields {...props} />)}
        {cell(<JobRolesButton {...props} />)}
        {!simple &&
          cell(
            <Select
              className="h-8"
              value={row.role}
              onChange={(e) => onEdit({ role: e.target.value as BulkRow['role'] })}
              aria-label={`Row ${index + 1} can see`}
              disabled={locked}
            >
              {(['employee', 'manager', 'admin'] as const)
                .filter((r) => powers.mayGrant(r) || r === row.role)
                .map((r) => (
                  <option key={r} value={r} disabled={!powers.mayGrant(r)}>
                    {CAN_SEE_LABEL[r]}
                  </option>
                ))}
            </Select>,
          )}
        {!simple &&
          cell(
            <Select
              className="h-8"
              value={row.engagement}
              onChange={(e) => onEdit({ engagement: e.target.value as BulkRow['engagement'] })}
              aria-label={`Row ${index + 1} works as`}
              disabled={locked}
            >
              <option value="in_house">{WORKS_AS_LABEL.in_house}</option>
              <option value="freelancer">{WORKS_AS_LABEL.freelancer}</option>
            </Select>,
          )}
        <td className="px-2 py-1.5 text-right align-top">
          <RowStatus {...props} />
        </td>
      </tr>
      {row.status === 'failed' && row.error && (
        <tr className="bg-destructive/5">
          <td />
          <td colSpan={simple ? 5 : 7} className="px-2 pb-2 text-xs text-destructive">
            {row.error}
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * The job roles for one row: the same picker "Add one person" uses. Library
 * defaults are kept as `lib:` keys and created on send; a role typed in here
 * is created at once, so it is on the list for every other row too.
 * "Use for every row" exists because a crew is usually one or two jobs
 * repeated — twelve candid photographers should be one click, not twelve.
 */
function RolePicker({
  row,
  pickable,
  onCreate,
  onClose,
  onChange,
  onApplyToAll,
}: {
  row: BulkRow | null
  pickable: readonly PickableRole[]
  onCreate: ((name: string, stage: ProductionStage) => Promise<string>) | undefined
  onClose: () => void
  onChange: (roleKeys: string[]) => void
  onApplyToAll: (roleKeys: string[]) => void
}) {
  const chosen = row?.roleKeys ?? []

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title={row?.name.trim() ? `Job roles for ${row.name.trim()}` : 'Job roles'}
        description="What they get booked for. Pick as many as apply."
      >
        <div className="max-h-[60vh] overflow-y-auto">
          <JobRolePicker pickable={pickable} chosen={chosen} onChange={onChange} onCreate={onCreate} compact />
        </div>
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
