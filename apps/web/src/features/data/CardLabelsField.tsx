import { useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { addCardLabels } from './cards'

/**
 * The cards by name: type "SD-04" and press Enter (or a comma); each becomes
 * a chip with its own ×. Enter never submits the dialog around it.
 */
export function CardLabelsField({ id, value, onChange }: { id?: string; value: string[]; onChange: (labels: string[]) => void }) {
  const [typed, setTyped] = useState('')
  const commit = () => {
    if (!typed.trim()) return
    onChange(addCardLabels(value, typed))
    setTyped('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
      {value.map((label) => (
        <span key={label} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
          {label}
          <button
            type="button"
            className="rounded-full text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${label}`}
            onClick={() => onChange(value.filter((x) => x !== label))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Input
        id={id}
        value={typed}
        placeholder={value.length ? 'Add another' : 'e.g. SD-04, then Enter'}
        className="h-7 min-w-[8rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(',')) {
            onChange(addCardLabels(value, v))
            setTyped('')
          } else setTyped(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !typed && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={commit}
      />
    </div>
  )
}
