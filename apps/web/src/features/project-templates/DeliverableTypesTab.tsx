import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Archive, Plus } from 'lucide-react'
import type { DeliverableType } from '@ipc/contracts'
import { deliverableRuleForTitle, findStudioType, internalLeadDaysForTitle } from '@ipc/domain'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import {
  useAddDeliverableType,
  useArchiveDeliverableType,
  useDeliverableTypes,
  useUpdateDeliverableType,
} from '@/features/projects/api'
import { daysText, parseDays } from './deliverable-types'

/**
 * One grid for the header and every row. On a phone the name takes the first
 * line (with the button beside it) and the two day boxes share the second, so
 * nothing scrolls sideways; from `sm` up it is one line per type. Rows draw
 * the line under themselves: the header is hidden on a phone, so a line above
 * the first row would double the table's own border.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_11rem_9.5rem_2.25rem] sm:py-2'
const NAME_CELL = 'col-span-2 sm:col-span-1'
const DAYS_CELL = 'row-start-2 sm:row-start-auto'
const ACTION_CELL = 'col-start-3 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto'

const CLIENT_LABEL = 'Client gets it after'
const WORK_LABEL = 'Work needed'

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur()
}

/**
 * The studio's own list of what it delivers: when the client gets each thing
 * and how many days the work needs. A new project fills a deliverable of the
 * same name from here; the "Start by" dates count back from the work needed.
 * Each box saves when you leave it. Admins and managers change the list
 * (0179); everyone else reads it.
 */
export function DeliverableTypesTab() {
  const q = useDeliverableTypes()
  const update = useUpdateDeliverableType()
  const archive = useArchiveDeliverableType()
  const { session } = useAuth()
  const access = useAccess()
  const canEdit =
    access.hasAction('projects', 'edit') && ['super_admin', 'admin', 'manager'].includes(session?.role ?? '')
  const all = q.data ?? []
  const live = all.filter((t) => !t.is_archived)

  // Archiving is one tap and one tap back: the Undo lives here, not on the
  // row, because the row is gone the moment the list refreshes.
  const onArchive = (t: DeliverableType) =>
    archive.mutate(t.id, {
      onSuccess: () =>
        toast.success(`Archived “${t.title}”`, {
          action: { label: 'Undo', onClick: () => update.mutate({ id: t.id, is_archived: false }) },
        }),
    })

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        What you deliver and how long it takes. New projects use these numbers, and “Start by” dates count back
        from the work needed. A blank box uses the usual number.
      </p>

      {q.isLoading ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div role="table" aria-label="Deliverable types" className="overflow-hidden rounded-lg border border-border">
          <div
            role="row"
            className={cn(ROW, 'hidden bg-muted/50 text-xs font-medium text-muted-foreground sm:grid')}
          >
            <span role="columnheader">Deliverable</span>
            <span role="columnheader">{CLIENT_LABEL}</span>
            <span role="columnheader">{WORK_LABEL}</span>
            <span role="columnheader" className="sr-only">
              Archive
            </span>
          </div>

          {live.map((t) => (
            <TypeRow
              key={t.id}
              type={t}
              canEdit={canEdit}
              onSave={(patch) => update.mutateAsync({ id: t.id, ...patch })}
              onArchive={() => onArchive(t)}
            />
          ))}

          {live.length === 0 && (
            <div role="row" className="border-b border-border px-3 py-4 text-sm text-muted-foreground last:border-b-0">
              <p role="cell">
                {canEdit
                  ? 'Nothing here yet. Add what you deliver — Photo album, Highlight film, Reels — below.'
                  : 'Your studio has not set any yet.'}
              </p>
            </div>
          )}

          {canEdit && <AddRow types={all} />}
        </div>
      )}
    </div>
  )
}

type TypePatch = { title?: string; due_days?: number | null; work_days?: number | null }

function TypeRow({
  type,
  canEdit,
  onSave,
  onArchive,
}: {
  type: DeliverableType
  canEdit: boolean
  onSave: (patch: TypePatch) => Promise<unknown>
  onArchive: () => void
}) {
  if (!canEdit) {
    return (
      <div role="row" className={cn(ROW, 'text-sm')}>
        <span role="cell" className={cn(NAME_CELL, 'font-medium')}>
          {type.title}
        </span>
        <span role="cell" className={DAYS_CELL}>
          <ReadOnlyDays label={CLIENT_LABEL} value={type.due_days} guess={deliverableRuleForTitle(type.title).due_days} />
        </span>
        <span role="cell" className={DAYS_CELL}>
          <ReadOnlyDays label={WORK_LABEL} value={type.work_days} guess={internalLeadDaysForTitle(type.title)} />
        </span>
        <span role="cell" className={ACTION_CELL} />
      </div>
    )
  }

  return (
    <div role="row" className={ROW}>
      <div role="cell" className={NAME_CELL}>
        <NameBox value={type.title} onSave={(title) => onSave({ title })} />
      </div>
      <div role="cell" className={DAYS_CELL}>
        <DaysBox
          label={CLIENT_LABEL}
          name={type.title}
          value={type.due_days}
          placeholder={String(deliverableRuleForTitle(type.title).due_days)}
          onSave={(due_days) => onSave({ due_days })}
        />
      </div>
      <div role="cell" className={DAYS_CELL}>
        <DaysBox
          label={WORK_LABEL}
          name={type.title}
          value={type.work_days}
          placeholder={String(internalLeadDaysForTitle(type.title))}
          onSave={(work_days) => onSave({ work_days })}
        />
      </div>
      <div role="cell" className={ACTION_CELL}>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={onArchive}
          title="Archive"
        >
          <Archive />
          <span className="sr-only">Archive {type.title}</span>
        </Button>
      </div>
    </div>
  )
}

/** The name, saved when you leave the box. A name cannot be blank, so blank puts it back. */
function NameBox({ value, onSave }: { value: string; onSave: (title: string) => Promise<unknown> }) {
  const [text, setText] = useState(value)
  // A save (here or in another tab) is the new truth for this box only.
  useEffect(() => setText(value), [value])

  const commit = () => {
    const next = text.trim()
    if (!next || next === value) {
      setText(value)
      return
    }
    onSave(next).catch(() => setText(value))
  }

  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={blurOnEnter}
      maxLength={200}
      aria-label={`Name of ${value}`}
      className="h-8 sm:text-sm"
    />
  )
}

/** A day count, saved when you leave the box. The placeholder is the usual number a blank stands for. */
function DaysBox({
  label,
  name,
  value,
  placeholder,
  onSave,
}: {
  label: string
  name: string
  value: number | null
  placeholder: string
  onSave: (days: number | null) => Promise<unknown>
}) {
  const [text, setText] = useState(daysText(value))
  useEffect(() => setText(daysText(value)), [value])

  const commit = () => {
    const parsed = parseDays(text)
    if (!parsed.ok) {
      toast.error(parsed.message)
      setText(daysText(value))
      return
    }
    if (parsed.value === value) {
      setText(daysText(value))
      return
    }
    onSave(parsed.value).catch(() => setText(daysText(value)))
  }

  return (
    <DaysField
      label={label}
      text={text}
      onChange={setText}
      onBlur={commit}
      onKeyDown={blurOnEnter}
      placeholder={placeholder}
      ariaLabel={`${label} (${name}), in days`}
    />
  )
}

/** The box itself: a label on a phone (the header row says it from `sm` up), the number, "days". */
function DaysField({
  label,
  text,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  ariaLabel,
}: {
  label: string
  text: string
  onChange: (text: string) => void
  onBlur?: () => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  ariaLabel: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground sm:sr-only">{label}</span>
      <span className="flex items-center gap-1.5">
        <Input
          inputMode="numeric"
          value={text}
          // Digits only: a stray letter would only come back as an error.
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          maxLength={3}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="h-8 w-16 px-2 tabular-nums sm:text-sm"
        />
        <span className="text-xs text-muted-foreground">days</span>
      </span>
    </label>
  )
}

function ReadOnlyDays({ label, value, guess }: { label: string; value: number | null; guess: number }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground sm:sr-only">{label}</span>
      <span className={cn('tabular-nums', value === null && 'text-muted-foreground')}>
        {value ?? guess} {(value ?? guess) === 1 ? 'day' : 'days'}
      </span>
    </span>
  )
}

/**
 * The last row: type a name (and the days, if you know them) and press Enter.
 * A name already on the list is not added twice; an archived one comes back.
 */
function AddRow({ types }: { types: DeliverableType[] }) {
  const add = useAddDeliverableType()
  const [title, setTitle] = useState('')
  const [dueDays, setDueDays] = useState('')
  const [workDays, setWorkDays] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const name = title.trim()

  const submit = () => {
    if (!name || add.isPending) return
    const due = parseDays(dueDays)
    if (!due.ok) {
      toast.error(due.message)
      return
    }
    const work = parseDays(workDays)
    if (!work.ok) {
      toast.error(work.message)
      return
    }
    const already = findStudioType(types, name)
    if (already) {
      toast.info(`“${already.title}” is already on your list.`)
      return
    }
    const archived = types.some((t) => t.is_archived && t.title.trim().toLowerCase() === name.toLowerCase())
    add.mutate(
      { title: name, due_days: due.value, work_days: work.value },
      {
        onSuccess: (saved) => {
          toast.success(archived ? `Brought back “${saved.title}”` : `Added “${saved.title}”`)
          setTitle('')
          setDueDays('')
          setWorkDays('')
          nameRef.current?.focus()
        },
      },
    )
  }

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
  }

  return (
    <div role="row" className={cn(ROW, 'bg-muted/30')}>
      <div role="cell" className={NAME_CELL}>
        <Input
          ref={nameRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onEnter}
          maxLength={200}
          placeholder="Add a deliverable, e.g. Photo album"
          aria-label="New deliverable name"
          className="h-8 sm:text-sm"
        />
      </div>
      <div role="cell" className={DAYS_CELL}>
        <DaysField
          label={CLIENT_LABEL}
          text={dueDays}
          onChange={setDueDays}
          onKeyDown={onEnter}
          placeholder={String(deliverableRuleForTitle(name).due_days)}
          ariaLabel={`${CLIENT_LABEL} (new deliverable), in days`}
        />
      </div>
      <div role="cell" className={DAYS_CELL}>
        <DaysField
          label={WORK_LABEL}
          text={workDays}
          onChange={setWorkDays}
          onKeyDown={onEnter}
          placeholder={String(internalLeadDaysForTitle(name))}
          ariaLabel={`${WORK_LABEL} (new deliverable), in days`}
        />
      </div>
      <div role="cell" className={ACTION_CELL}>
        <Button size="icon" className="size-8" onClick={submit} disabled={!name || add.isPending} title="Add">
          <Plus />
          <span className="sr-only">Add deliverable type</span>
        </Button>
      </div>
    </div>
  )
}
