import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, CornerDownLeft, type LucideIcon } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { cn } from '../ui/cn'
import { rankBy } from '../ui/command-score'
import { navDestinations } from './nav'
import { useClients } from '@/features/clients/api'
import { useProjects } from '@/features/projects/api'
import { useDirectory } from '@/features/team/api'
import { useLeadSearch } from '@/features/crm/api'
import { seesStudioWork } from '@ipc/permissions'

interface Command {
  id: string
  label: string
  hint?: string
  to: string
  params?: Record<string, string>
  /** For a record that opens through a query string rather than a path. */
  search?: Record<string, string>
  group: string
  icon?: LucideIcon
}

const OPEN_EVENT = 'ipc:open-command-palette'

/** Open the palette from anywhere — the topbar button uses this. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/**
 * The key to print on the trigger. Mac keyboards say Command; everything else
 * says Ctrl, and showing the wrong one makes the hint worse than none.
 */
export function paletteShortcutHint(platform = navigator.userAgent): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘K' : 'Ctrl K'
}

/**
 * Cmd+K / Ctrl+K search over everything this studio can reach.
 *
 * Destinations come from the same filtered nav the sidebar renders, so the
 * palette can never offer a page the signed-in user is not allowed to open. A
 * search box that lists things and then refuses them is worse than no search
 * box at all.
 *
 * The record queries live in a child that only mounts while the palette is
 * open, so nothing is fetched for a shortcut nobody pressed.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ipc-overlay fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          className="ipc-dialog fixed left-1/2 top-[15%] z-50 w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Jump to a page, lead, client, project or team member.
          </DialogPrimitive.Description>
          {open && <PaletteBody onClose={() => setOpen(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const { session } = useAuth()
  const access = useAccess()
  const listRef = useRef<HTMLDivElement>(null)

  // Only reached while the palette is open, so these are not background work.
  const clients = useClients()
  const team = useDirectory()

  /*
   * Leads are the one record type not loaded whole.
   *
   * The others fetch every row and rank in the browser, which is fine for a few
   * hundred clients. A studio's lead book is the list that grows without limit,
   * and filtering a truncated copy of it is exactly the bug this search was
   * built to stop -- so this asks the server, with a pause so a typed name is
   * one request rather than one per letter.
   */
  const [typed, setTyped] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTyped(query), 200)
    return () => clearTimeout(t)
  }, [query])
  const leads = useLeadSearch(access.hasModule('crm') ? typed : '')
  // Projects too: the server matches name, client and phone, eight at a time
  // (the newest eight before anything is typed), instead of every project.
  const projects = useProjects({ page: 1, page_size: 8, ...(typed.trim() ? { search: typed.trim() } : {}) })

  const commands = useMemo<Command[]>(() => {
    const pages: Command[] = navDestinations(
      session?.role ?? '',
      access,
      !!session?.is_platform_admin,
    ).map((l) => ({
      id: `page:${l.to}`,
      label: l.label,
      to: l.to,
      group: 'Pages',
      ...(l.icon ? { icon: l.icon } : {}),
    }))

    const clientCmds: Command[] = (Array.isArray(clients.data) ? clients.data : []).map((c) => ({
      id: `client:${c.id}`,
      label: c.name,
      ...(c.phone ? { hint: c.phone } : {}),
      // Opens that client, not the whole list (?client= is the list's deep link).
      to: '/clients',
      search: { client: c.id },
      group: 'Clients',
    }))

    const projectCmds: Command[] = (projects.data ?? []).map((p) => ({
      id: `project:${p.id}`,
      label: p.name,
      ...(p.client_name ? { hint: p.client_name } : {}),
      // Staff open their own view of a project, not the studio's page.
      ...(seesStudioWork(access)
        ? { to: '/projects/$id', params: { id: p.id } }
        : { to: '/my-work/project/$projectId', params: { projectId: p.id } }),
      group: 'Projects',
    }))

    const teamCmds: Command[] = (team.data ?? []).map((m) => ({
      id: `member:${m.user_id}`,
      label: m.name,
      ...(m.email ? { hint: m.email } : {}),
      to: '/employees',
      group: 'Team',
    }))

    const leadCmds: Command[] = (leads.data ?? []).map((l) => ({
      id: `lead:${l.id}`,
      label: l.name ?? 'Unnamed lead',
      // The phone is what people search a lead by, so it has to be part of
      // what the ranking sees, not just decoration.
      ...(l.phone ? { hint: l.phone } : {}),
      to: '/follow-ups',
      search: { lead: l.id },
      group: 'Leads',
    }))

    return [...pages, ...clientCmds, ...projectCmds, ...teamCmds, ...leadCmds]
  }, [clients.data, projects.data, team.data, leads.data, session, access])

  const results = useMemo(() => {
    // The hint counts: a studio searching a lead types the phone number far
    // more often than the spelling of the name, and the same is true of a
    // project's client or a member's email.
    const ranked = rankBy(query, commands, (c) => (c.hint ? `${c.label} ${c.hint}` : c.label), 12)
    // Keep each group contiguous. Ranking alone interleaves them, and the
    // header logic below would then print one group's heading more than once.
    const order: string[] = []
    for (const c of ranked) if (!order.includes(c.group)) order.push(c.group)
    return order.flatMap((g) => ranked.filter((c) => c.group === g))
  }, [query, commands])

  // A stale highlight can point past the end of a shorter result list, or at a
  // different command entirely once the record queries resolve and re-rank —
  // so this follows `results`, not just the text typed.
  useEffect(() => { setActive(0) }, [results])

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function run(cmd: Command | undefined) {
    if (!cmd) return
    onClose()
    void navigate(
      cmd.params
        ? { to: cmd.to, params: cmd.params }
        : cmd.search
          ? ({ to: cmd.to, search: cmd.search } as never)
          : ({ to: cmd.to } as never),
    )
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[active])
    }
  }

  let lastGroup = ''

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search leads, clients, projects, pages…"
          aria-label="Search"
          aria-controls="command-results"
          className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[0.65rem] text-muted-foreground sm:block">
          esc
        </kbd>
      </div>

      <div
        ref={listRef}
        id="command-results"
        role="listbox"
        aria-label="Results"
        className="max-h-80 overflow-y-auto p-2"
      >
        {results.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Nothing matches that.
          </p>
        ) : (
          results.map((cmd, i) => {
            const header = cmd.group !== lastGroup ? cmd.group : null
            lastGroup = cmd.group
            const Icon = cmd.icon
            return (
              <div key={cmd.id}>
                {header && (
                  <p className="px-3 pb-1 pt-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(cmd)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm',
                    i === active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {Icon && <Icon className="size-4 shrink-0 opacity-70" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                  {cmd.hint && (
                    <span
                      className={cn(
                        'shrink-0 truncate text-xs',
                        i === active ? 'opacity-80' : 'text-muted-foreground',
                      )}
                    >
                      {cmd.hint}
                    </span>
                  )}
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0" aria-hidden />}
                </button>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
