import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, Building2, Check, ChevronDown, Loader2, LogOut, Palette, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { companyProfile, type StudioMembership } from '@ipc/contracts'
import { callApi } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { Avatar } from '../ui/avatar'
import { cn } from '../ui/cn'
import { humanize } from '../ui/format'

/**
 * Who you are signed in as, and the two or three things you do about it.
 *
 * The header used to print a bare name with nowhere to click, and Log out was
 * buried at the foot of the sidebar — invisible whenever the rail was
 * collapsed or the drawer shut. Both now live behind the avatar, which is
 * where people look for them.
 *
 * Destinations are gated on the same module check the sidebar uses, so the
 * menu can never offer a page this account would be bounced out of.
 */
export function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { session } = useAuth()
  const access = useAccess()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // The shell outlives navigation now, so nothing else would shut this.
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!session) return null
  const canSettings = access.hasModule('settings')

  /** Arrow keys walk the items, the way a menu is expected to behave. */
  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    items[(at + step + items.length) % items.length]?.focus()
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-lg py-1 pl-2 pr-1.5 text-sm transition-colors hover:bg-muted',
          open && 'bg-muted',
        )}
      >
        <span className="hidden max-w-[10rem] truncate text-muted-foreground sm:inline">
          {session.display_name}
        </span>
        <Avatar name={session.display_name} size="md" />
        <ChevronDown
          className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label="Account"
          onKeyDown={onPanelKeyDown}
          className="ipc-menu absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <Identity name={session.display_name} email={session.email} role={session.role} />

          {session.studios.length > 1 && (
            <StudioSwitcher studios={session.studios} current={session.user_id} />
          )}

          {canSettings && (
            <div className="border-t border-border p-1.5">
              <Item to="/settings/company" icon={Building2} label="Company Profile" />
              <Item to="/settings/appearance" icon={Palette} label="Appearance" />
            </div>
          )}

          <div className="border-t border-border p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="size-4 shrink-0" aria-hidden />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The studio name above the person's own, because one login can belong to more
 * than one studio over time and "which account am I in?" is the question this
 * menu is opened to answer.
 */
function Identity({ name, email, role }: { name: string; email: string; role: string }) {
  // Only fetched once the menu is open — the trigger does not need it, and the
  // settings page shares this cache entry.
  const company = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
    staleTime: 5 * 60_000,
  })

  return (
    <div className="flex items-start gap-3 p-3">
      <Avatar name={name} size="lg" />
      <div className="min-w-0 flex-1">
        {company.data?.name && (
          <p className="truncate text-xs text-muted-foreground">{company.data.name}</p>
        )}
        <p className="truncate font-semibold leading-tight">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
        {role !== 'none' && (
          <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-brand">
            {humanize(role)}
          </p>
        )}
      </div>
    </div>
  )
}

function Item({
  to,
  icon: Icon,
  label,
}: {
  to: string
  icon: LucideIcon
  label: string
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {label}
    </Link>
  )
}

/**
 * The other studios this login belongs to.
 *
 * One person can be on several studios' teams under one email -- a freelancer
 * shooting for three studios, or an owner who runs two -- and each studio is
 * its own workspace with its own data. This is how they move between them
 * without signing out; the current one is ticked.
 */
function StudioSwitcher({ studios, current }: { studios: StudioMembership[]; current: string }) {
  const { switchStudio } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)

  async function go(profileId: string) {
    if (profileId === current || busy) return
    setBusy(profileId)
    try {
      await switchStudio(profileId)
    } catch (e) {
      setBusy(null)
      toast.error(e instanceof Error ? e.message : 'We could not open that studio.')
    }
  }

  return (
    <div className="border-t border-border p-1.5">
      <p className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        <ArrowLeftRight className="size-3" aria-hidden /> Switch studio
      </p>
      {studios.map((s) => {
        const here = s.profile_id === current
        return (
          <button
            key={s.profile_id}
            type="button"
            role="menuitem"
            onClick={() => void go(s.profile_id)}
            aria-current={here || undefined}
            disabled={!!busy}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60',
              here && 'bg-muted/60',
            )}
          >
            <Avatar name={s.company_name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.company_name}</span>
              <span className="block text-xs text-muted-foreground">
                {s.is_owner ? 'Owner' : humanize(s.role)}
              </span>
            </span>
            {busy === s.profile_id ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            ) : here ? (
              <Check className="size-4 text-primary" aria-label="Current studio" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
