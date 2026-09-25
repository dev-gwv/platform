import { Link } from '@tanstack/react-router'
import { UserRoundCheck } from 'lucide-react'
import { PROFILE_FIELD_LABEL } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useMyProfile } from './api'

/**
 * "Complete your profile" -- on the dashboard for as long as anything is
 * missing. There is no dismiss: it goes away when the profile is complete,
 * and a reminder arrives every morning until then.
 */
export function ProfileBanner() {
  const { session } = useAuth()
  const { data } = useMyProfile()
  if (!data || session?.is_owner || data.completeness.missing.length === 0) return null
  const { percent, missing } = data.completeness
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <UserRoundCheck className="size-6 shrink-0 text-primary" aria-hidden />
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm font-semibold">Complete your profile · {percent}% done</p>
          <div className="mt-1.5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted" aria-label={`${percent}% complete`}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Still needed: {missing.map((m) => PROFILE_FIELD_LABEL[m]).join(', ')}
          </p>
        </div>
        <Button asChild>
          <Link to="/profile">Complete profile</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
