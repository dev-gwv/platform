import { Link } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { formatPaise } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { useWallet } from './api'

/**
 * "Messaging balance is low" on the owner's dashboard, while it is below
 * their alert level and something is switched on that needs it. Goes away
 * once the wallet is recharged.
 */
export function LowBalanceBanner() {
  const { data } = useWallet()
  if (!data?.low) return null
  const empty = data.balance_paise <= 0
  return (
    <Card className="mb-4 border-warning/40 bg-warning/10">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <Wallet className="size-6 shrink-0 text-warning" aria-hidden />
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-semibold">{empty ? 'WhatsApp messages have stopped' : 'Messaging balance is low'}</p>
          <p className="text-xs text-muted-foreground">
            Balance {formatPaise(data.balance_paise)}. {empty ? 'Recharge to send again.' : 'Recharge so messages keep going out.'}
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/settings/messaging">Recharge</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
