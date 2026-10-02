import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { LifeBuoy, Mail, MessageCircle, PlayCircle } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent } from '@/shared/ui/sheet'
import { cn } from '@/shared/ui/cn'
import { useHelp, useTutorials } from './api'
import { TutorialPlayer } from './TutorialPlayer'
import { lengthLabel, tutorialFor, type Tutorial } from './tutorials'
import { mailLink, supportMessage, whatsappLink } from './support'

const ROLE: Record<string, string> = {
  super_admin: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Team member',
  platform_admin: 'Platform admin',
  none: 'Member',
}

/**
 * Help, at the foot of the sidebar: "We're one message away" -- WhatsApp us
 * and Email us, opened with who is asking and from which page already
 * written -- this page's tutorial if it has one, every tutorial, and the
 * questions studios ask first.
 */
export function HelpButton({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'mb-2 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary',
          collapsed && 'justify-center px-0',
        )}
        aria-label="Help"
      >
        <LifeBuoy className="size-4 text-tone-teal" aria-hidden />
        {!collapsed && 'Help'}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="Help" className="sm:max-w-md">
          <HelpPanelBody onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}

function HelpPanelBody({ onNavigate }: { onNavigate: () => void }) {
  const { session } = useAuth()
  const help = useHelp().data
  const tutorials = useTutorials()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const here = tutorialFor(path, tutorials)
  const [playing, setPlaying] = useState<Tutorial | null>(null)
  const studio =
    session?.studios.find((s) => s.company_id === session.company_id)?.company_name ?? 'my studio'
  const message = supportMessage({
    studio,
    name: session?.display_name ?? '',
    role: ROLE[session?.role ?? 'none'] ?? 'Member',
    plan:
      session?.plan_gate === 'active'
        ? 'Paid'
        : session?.plan_gate === 'grandfathered'
          ? 'Trial'
          : (session?.plan_gate ?? null),
    page: path,
    at: new Date(),
  })

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
      {(help?.support_whatsapp || help?.support_email) && (
        <>
          <div>
            <p className="text-lg font-semibold">We're one message away</p>
            <p className="text-sm text-muted-foreground">
              Tell us what you need. Your studio and this page are already in the message.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {help?.support_whatsapp && (
              <Button asChild className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                <a
                  href={whatsappLink(help.support_whatsapp, message)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle /> WhatsApp us
                </a>
              </Button>
            )}
            {help?.support_email && (
              <Button
                asChild
                variant="outline"
                className={cn(!help.support_whatsapp && 'sm:col-span-2')}
              >
                <a href={mailLink(help.support_email, studio, message)}>
                  <Mail /> Email us
                </a>
              </Button>
            )}
          </div>
        </>
      )}

      {here && (
        <button
          type="button"
          onClick={() => setPlaying(here)}
          className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-left hover:bg-primary/10"
        >
          <PlayCircle className="size-8 shrink-0 text-primary" aria-hidden />
          <span>
            <span className="block text-sm font-semibold">Watch how this page works</span>
            <span className="block text-xs text-muted-foreground">
              {here.title}
              {here.seconds ? ` · ${lengthLabel(here.seconds)}` : ''}
            </span>
          </span>
        </button>
      )}

      <Button asChild variant="outline">
        <Link to="/help" onClick={onNavigate}>
          <PlayCircle /> All tutorials
        </Link>
      </Button>

      {(help?.faqs.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Questions studios ask</p>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {help!.faqs.map((f) => (
              <details key={f.id} className="group px-3 py-2.5">
                <summary className="cursor-pointer list-none text-sm font-medium marker:hidden group-open:text-primary">
                  {f.question}
                </summary>
                <p className="mt-1.5 whitespace-pre-line text-sm text-muted-foreground">
                  {f.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      )}
      <TutorialPlayer tutorial={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}
