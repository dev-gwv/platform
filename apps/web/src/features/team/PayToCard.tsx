import { Copy, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { usePayTo } from '@/features/profile/api'

/**
 * Where this person wants their pay, shown in the dialog where it is paid --
 * so nobody has to message them for their UPI ID first. Shown only to whoever
 * pays the team (the server checks and records every look).
 */
export function PayToCard({ userId }: { userId: string | null }) {
  const q = usePayTo(userId)
  if (!userId || q.isError || (!q.isLoading && !q.data)) return null
  if (q.isLoading) return <div className="h-14 animate-pulse rounded-md bg-muted" aria-hidden />
  const p = q.data!
  const hasBank = !!p.bank_account_number && !!p.bank_ifsc
  if (!p.upi_id && !hasBank) {
    return (
      <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        {p.name} has not added UPI or bank details yet. They are reminded every day until they do.
      </p>
    )
  }
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Wallet className="size-3.5" aria-hidden /> Pay to
      </p>
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
