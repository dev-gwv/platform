import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MessageCircle, MonitorSmartphone, X } from 'lucide-react'
import { buildWhatsAppUrl, type TeamMember } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'
import { useHints, useSetHint } from './hints-api'
import { lastSeenText, loginMessage, namesText, noteDue } from './assign-note'

/**
 * Said once, plainly, right after work is assigned: the member sees it on
 * their own login. New studios did not know a team dashboard existed.
 *
 * Only for a studio person's first few assignments (ASSIGN_NOTE_TIMES), and
 * "Got it, don't show again" closes it for good -- the owner did not want it
 * nagging. × closes just this one.
 */
export function AssignedNote({ members, onClose, className }: { members: readonly TeamMember[]; onClose: () => void; className?: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const hints = useHints()
  const setHint = useSetHint()
  // Decided once, when the note first has what it needs -- the count it bumps
  // must not make it vanish mid-read.
  const [due, setDue] = useState<boolean | null>(null)
  const counted = useRef(false)

  const people = members.filter((m) => m.user_id !== session?.user_id)
  const hint = hints.data?.assign_note

  useEffect(() => {
    if (due !== null || !hints.isSuccess) return
    setDue(people.length > 0 && noteDue(hint))
  }, [due, hints.isSuccess, hint, people.length])

  useEffect(() => {
    if (!due || counted.current) return
    counted.current = true
    setHint.mutate({ key: 'assign_note', value: { shown: (hint?.shown ?? 0) + 1, closed: hint?.closed ?? false } })
  }, [due, hint, setHint])

  if (!due) return null

  const studio = session?.studios.find((s) => s.company_id === session.company_id)?.company_name ?? 'the studio'
  const loginUrl = `${window.location.origin}/login`
  const withLogin = people.filter((m) => m.login_enabled)
  const noLogin = people.filter((m) => !m.login_enabled)
  const one = people.length === 1 ? people[0]! : null
  const canPreview = access.hasModule('team_work_preview')

  const closeForGood = () => {
    setHint.mutate({ key: 'assign_note', value: { shown: hint?.shown ?? 0, closed: true } })
    onClose()
  }

  return (
    <div
      role="status"
      className={cn('relative flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 pr-9 text-sm', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <MonitorSmartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1.5">
        {withLogin.length > 0 && (
          <p>
            <span className="font-semibold">
              {namesText(withLogin.map((m) => m.name))} will see this on {withLogin.length === 1 ? 'their own login' : 'their own logins'}.
            </span>{' '}
            <span className="text-muted-foreground">It is under “My work” when they open Studio AutoPilot.</span>
          </p>
        )}
        {noLogin.length > 0 && (
          <p>
            <span className="font-semibold">{namesText(noLogin.map((m) => m.name))} {noLogin.length === 1 ? 'has' : 'have'} no login yet,</span>{' '}
            <span className="text-muted-foreground">so they will not see it in the app.</span>{' '}
            <Link to="/employees" className="font-medium text-primary hover:underline">
              Give a login from Team
            </Link>
          </p>
        )}

        {/* Who has actually been in: the reason to send the login at all. */}
        {withLogin.length > 0 && (
          <ul className="flex flex-col gap-1">
            {withLogin.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">
                  {m.name.split(' ')[0]} {lastSeenText(m.last_seen_at)}.
                </span>
                {!m.last_seen_at && m.phone && (
                  <a
                    href={buildWhatsAppUrl(m.phone, loginMessage({ name: m.name, studio, email: m.email, loginUrl }))}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#1fb857]"
                  >
                    <MessageCircle className="size-3.5" aria-hidden /> Send {m.name.split(' ')[0]} the login
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs">
          {one && one.login_enabled && canPreview && (
            <Link to="/team/work-preview" search={{ user: one.user_id } as never} className="font-medium text-primary hover:underline">
              See what {one.name.split(' ')[0]} sees
            </Link>
          )}
          <button type="button" onClick={closeForGood} className="font-medium text-muted-foreground hover:text-foreground hover:underline">
            Got it, don’t show again
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
