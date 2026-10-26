import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/shared/ui/cn'

/**
 * A value that is read most of the time and corrected now and then: the
 * value, a pencil beside it, and on a tap a box in its place. Enter or
 * leaving the box saves, Escape puts it back. A name typed wrong on the
 * first call used to stay wrong for good (owner, 26 Oct).
 */
export function InlineField({
  value,
  label,
  onSave,
  children,
  disabled = false,
  inputMode,
  type = 'text',
  className,
  inputClassName,
  validate,
}: {
  value: string | null
  /** Says what is being changed, for the pencil and the box. */
  label: string
  onSave: (next: string | null) => void
  /** How the value reads when it is not being changed. */
  children: ReactNode
  disabled?: boolean
  inputMode?: 'text' | 'tel' | 'email'
  type?: 'text' | 'email' | 'tel'
  className?: string
  inputClassName?: string
  /** A sentence when the typed value cannot be saved; null when it can. */
  validate?: (next: string) => string | null
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  function start() {
    setDraft(value ?? '')
    setError(null)
    setEditing(true)
  }

  function commit() {
    const next = draft.trim()
    if (next === (value ?? '').trim()) {
      setEditing(false)
      return
    }
    const problem = validate?.(next) ?? null
    if (problem) {
      setError(problem)
      return
    }
    onSave(next || null)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className={cn('inline-flex flex-col gap-0.5', className)}>
        <input
          ref={ref}
          aria-label={label}
          type={type}
          inputMode={inputMode}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setEditing(false)
            }
          }}
          className={cn(
            'h-8 min-w-48 rounded-md border border-primary/60 bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
            error && 'border-destructive',
            inputClassName,
          )}
        />
        {error && <span className="text-xs text-destructive">{error}</span>}
      </span>
    )
  }

  return (
    <span className={cn('group inline-flex min-w-0 items-center gap-1.5', className)}>
      {children}
      {!disabled && (
        <button
          type="button"
          onClick={start}
          title={`Change ${label.toLowerCase()}`}
          aria-label={`Change ${label.toLowerCase()}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
      )}
    </span>
  )
}
