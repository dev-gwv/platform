import { useState } from 'react'
import { Copy, Pencil, Plus, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import type { PayTo } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { usePayTo, useSetPayTo } from '@/features/profile/api'
import { missingPayToText } from './pay-to'

/**
 * Where this person wants their pay, shown in the dialog where it is paid --
 * so nobody has to message them for their UPI ID first. Shown only to whoever
 * pays the team (the server checks and records every look). The same people
 * can add or fix the details here; the person is told when they change.
 */
export function PayToCard({ userId }: { userId: string | null }) {
  const q = usePayTo(userId)
  const [editing, setEditing] = useState(false)
  if (!userId || q.isError || (!q.isLoading && !q.data)) return null
  if (q.isLoading) return <div className="h-14 animate-pulse rounded-md bg-muted" aria-hidden />
  const p = q.data!
  if (editing) return <PayToForm userId={userId} current={p} onDone={() => setEditing(false)} />
  const hasBank = !!p.bank_account_number && !!p.bank_ifsc
  if (!p.upi_id && !hasBank) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <p className="min-w-0 flex-1">{missingPayToText(p.name, p.login_enabled)}</p>
        <Button type="button" size="sm" onClick={() => setEditing(true)}>
          <Plus /> Add UPI or bank
        </Button>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Wallet className="size-3.5" aria-hidden /> Pay to
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      </div>
      {p.upi_id && <Line label="UPI" value={p.upi_id} />}
      {hasBank && (
        <>
          <Line label="Account" value={p.bank_account_number!} />
          <Line label="IFSC" value={p.bank_ifsc!} />
          {p.bank_account_name && <Line label="Name" value={p.bank_account_name} copy={false} />}
        </>
      )}
    </div>
  )
}

const tone = (v: string) => (v.trim() ? 'border-success/60' : 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20')

function PayToForm({ userId, current, onDone }: { userId: string; current: PayTo; onDone: () => void }) {
  const [upi, setUpi] = useState(current.upi_id ?? '')
  const [acct, setAcct] = useState(current.bank_account_number ?? '')
  const [ifsc, setIfsc] = useState(current.bank_ifsc ?? '')
  const [holder, setHolder] = useState(current.bank_account_name ?? current.name)
  const save = useSetPayTo(userId)
  const bankHalf = (!!acct.trim()) !== (!!ifsc.trim())
  const nothing = !upi.trim() && !acct.trim()
  // A div, not a form: this card sits inside the Pay dialog's own form, and a
  // nested form would submit the payment instead of these details.
  const submit = () =>
    save.mutate(
      { upi_id: upi, bank_account_number: acct, bank_ifsc: ifsc, bank_account_name: acct.trim() ? holder : '' },
      { onSuccess: onDone },
    )
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          e.stopPropagation()
          if (!save.isPending && !bankHalf && !nothing) submit()
        }
      }}
    >
      <p className="font-semibold">Where should {current.name}'s pay go?</p>
      <label className="flex flex-col gap-1 text-xs font-medium">
        UPI ID
        <Input className={cn(tone(upi))} placeholder="e.g. ravi@okicici" value={upi} onChange={(e) => setUpi(e.target.value)} autoFocus />
      </label>
      <p className="text-xs text-muted-foreground">or a bank account</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Account number
          <Input inputMode="numeric" className={cn(tone(acct))} placeholder="e.g. 50100234567890" value={acct} onChange={(e) => setAcct(e.target.value.replace(/\s/g, ''))} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          IFSC
          <Input className={cn(tone(ifsc))} placeholder="e.g. HDFC0001234" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} />
        </label>
      </div>
      {acct.trim() && (
        <label className="flex flex-col gap-1 text-xs font-medium">
          Name on the account
          <Input className={cn(tone(holder))} value={holder} onChange={(e) => setHolder(e.target.value)} />
        </label>
      )}
      {bankHalf && <p className="text-xs text-warning">A bank account needs both the number and the IFSC.</p>}
      {current.login_enabled && <p className="text-xs text-muted-foreground">{current.name} will be told their payment details changed.</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={save.isPending || bankHalf || nothing} onClick={submit}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Line({ label, value, copy = true }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium tabular-nums">{value}</span>
      {copy && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied`))}
        >
          <Copy className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
