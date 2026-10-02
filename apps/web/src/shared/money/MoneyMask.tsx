import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useHints, useSetHint } from '@/features/team/hints-api'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { amountsHidden, MASK, screenINR, setAmountsHidden, subscribeAmounts } from './hide'

/** True while this person has amounts hidden. Re-renders when it changes. */
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribeAmounts, amountsHidden, () => false)
}

/**
 * The rupee formatter for the studio's own screens. Use it instead of
 * `formatINR` anywhere but a document, a public page or a client message:
 * `const inr = useINR()` then `inr(12000)`.
 */
export function useINR(): (amount: number) => string {
  const hidden = useAmountsHidden()
  return useCallback((amount: number) => screenINR(amount, hidden), [hidden])
}

/** One amount; while hidden it reads "₹ ••••" and a tap shows just this one. */
export function Money({ value, className }: { value: number; className?: string }) {
  const hidden = useAmountsHidden()
  const [peek, setPeek] = useState(false)
  useEffect(() => setPeek(false), [hidden])
  if (!hidden || peek) return <span className={cn('tabular-nums', className)}>{screenINR(value, false)}</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setPeek(true)
      }}
      className={cn('tabular-nums tracking-wide', className)}
      title="Tap to show"
    >
      {MASK}
    </button>
  )
}

/** Keeps the page's switch in step with the person's saved choice. */
export function useSyncHideAmounts() {
  const hints = useHints()
  const saved = hints.data?.hide_amounts?.closed === true
  useEffect(() => {
    if (hints.isSuccess) setAmountsHidden(saved)
  }, [hints.isSuccess, saved])
}

/** The eye in the top bar: hide or show every amount, remembered on every device. */
export function HideAmountsButton() {
  useSyncHideAmounts()
  const hidden = useAmountsHidden()
  const setHint = useSetHint()
  const flip = () => {
    const next = !hidden
    setAmountsHidden(next)
    setHint.mutate({ key: 'hide_amounts', value: { shown: 0, closed: next } })
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={flip}
      aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
      aria-pressed={hidden}
      title={hidden ? 'Show amounts' : 'Hide amounts'}
      className={cn(hidden && 'text-primary')}
    >
      {hidden ? <EyeOff /> : <Eye />}
    </Button>
  )
}
