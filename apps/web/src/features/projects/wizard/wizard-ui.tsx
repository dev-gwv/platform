import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Label } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'

/** Close a hand-rolled menu on a press outside it, or on Escape. */
export function useDismiss(root: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const onClose = useRef(close)
  onClose.current = close
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose.current()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose.current()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, root])
}

export function Field({
  label,
  required,
  hint,
  icon: Icon,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  icon?: LucideIcon
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5 text-muted-foreground" aria-hidden />}
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A titled block inside a shoot card: heading, hint, buttons, body. */
export function SubCard({
  icon: Icon,
  title,
  hint,
  actions,
  children,
}: {
  icon: LucideIcon
  title: string
  hint: string
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            {title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  )
}

/** The dashed "nothing here yet" strip inside a sub-card. */
export function Band({ tone, children }: { tone?: 'warning'; children: ReactNode }) {
  return (
    <p
      className={cn(
        'rounded-md border border-dashed px-3 py-4 text-center text-sm',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}
