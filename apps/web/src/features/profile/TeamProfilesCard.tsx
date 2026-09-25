import { Link } from '@tanstack/react-router'
import { UsersRound } from 'lucide-react'
import { PROFILE_FIELD_LABEL } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Card, CardContent } from '@/shared/ui/card'
import { useMembers } from '@/features/allocation/api'
import { useTeamProfileGaps } from './api'

/**
 * The owner's view: who on the team has not finished their profile, and what
 * is missing. They are reminded every morning; this is so the owner can nudge
 * in person too.
 */
export function TeamProfilesCard() {
  const gaps = useTeamProfileGaps()
  const members = useMembers()
  const open = (gaps.data ?? []).filter((g) => g.missing.length > 0).sort((a, b) => a.percent - b.percent)
  if (!open.length) return null
  const name = new Map((members.data ?? []).map((m) => [m.user_id, m.name]))
  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UsersRound className="size-4 text-primary" aria-hidden />
            {open.length} team {open.length === 1 ? 'profile is' : 'profiles are'} incomplete
          </p>
          <Link to="/employees" className="text-xs font-medium text-primary hover:underline">
            Team Directory
          </Link>
        </div>
        <ul className="mt-2 divide-y divide-border">
          {open.slice(0, 6).map((g) => (
            <li key={g.user_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Avatar name={name.get(g.user_id) ?? '?'} size="sm" />
              <span className="font-medium">{name.get(g.user_id) ?? 'Team member'}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{g.percent}%</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                needs {g.missing.map((m) => PROFILE_FIELD_LABEL[m].toLowerCase()).join(', ')}
              </span>
            </li>
          ))}
        </ul>
        {open.length > 6 && <p className="text-xs text-muted-foreground">+{open.length - 6} more</p>}
      </CardContent>
    </Card>
  )
}
