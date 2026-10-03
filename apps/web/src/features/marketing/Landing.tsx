import type { ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { plan } from '@ipc/contracts'
import { CalendarCheck, Facebook, Receipt, Users, type LucideIcon } from 'lucide-react'
import { buttonVariants } from '@/shared/ui/button'
import { IconTile, type Tone } from '@/shared/ui/icon-tile'
import { Wordmark } from '@/shared/ui/wordmark'
import { LegalLinks } from '@/features/legal/LegalPage'
import { LEGAL, PLANS, TRIAL_DAYS } from '@/features/legal/legal'
import { callApi } from '@/shared/api/client'
import { PlanPicker } from '@/features/billing/PlanPicker'

/**
 * What a stranger sees at the front door: who we are, what the software does,
 * how it uses Facebook leads, what it costs, and who runs it. No sign-in
 * needed. Meta's reviewers, payment gateways and a studio's first visit all
 * land here, so every claim is one the app really keeps.
 */

const WHAT: { icon: LucideIcon; tone: Tone; title: string; text: string }[] = [
  { icon: Users, tone: 'blue', title: 'Leads and follow-ups', text: 'Every enquiry in one pipeline, with who to call today.' },
  { icon: CalendarCheck, tone: 'violet', title: 'Shoots and team', text: 'Book the crew, see clashes, mark attendance.' },
  { icon: Receipt, tone: 'green', title: 'Billing and delivery', text: 'Quotes, invoices, payments and what is left to hand over.' },
]

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="text-xl">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-2" aria-label="Account">
            <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Sign in
            </Link>
            <Link to="/login" search={{ mode: 'register' } as never} className={buttonVariants({ size: 'sm' })}>
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <div className="mx-auto max-w-5xl px-4 pb-6 pt-12 sm:pt-20">
          <h1 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-5xl">
            Run your photography studio from one place.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {LEGAL.appName} brings your leads, shoots, team and billing together, built for wedding and event studios in India.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/login" search={{ mode: 'register' } as never} className={buttonVariants({ size: 'lg' })}>
              Start your {TRIAL_DAYS}-day free trial
            </Link>
            <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Sign in
            </Link>
          </div>
        </div>

        <Section title="What it does">
          <div className="grid gap-3 sm:grid-cols-3">
            {WHAT.map((w) => (
              <div key={w.title} className="rounded-2xl border border-border bg-card p-4">
                <IconTile icon={w.icon} tone={w.tone} size="lg" />
                <h3 className="mt-3 font-semibold">{w.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{w.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Leads from Facebook Lead Ads" id="facebook-leads">
          <div className="rounded-2xl border border-tone-blue/30 bg-tone-blue-soft/40 p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={Facebook} tone="blue" size="lg" />
              <ul className="flex flex-col gap-2 text-sm leading-relaxed sm:text-base">
                <li>A studio connects its own Facebook Page from Lead Sources.</li>
                <li>When someone fills in a lead form on that Page, the lead appears in the studio's CRM.</li>
                <li>
                  We read the form answers and the Page name. We never post to the Page, and we do not read your friends or posts.
                </li>
                <li>
                  The studio owns its leads: disconnect the Page, or delete leads for good, any time. See{' '}
                  <Link to="/privacy-policy" className="font-medium text-primary hover:underline">
                    Privacy
                  </Link>{' '}
                  and{' '}
                  <Link to="/data-deletion" className="font-medium text-primary hover:underline">
                    Data Deletion
                  </Link>
                  .
                </li>
              </ul>
            </div>
          </div>
        </Section>

        <Section title="Price">
          <PublicPrice fallback={
          <div className="grid gap-3 sm:grid-cols-2">
            {PLANS.map((p) => (
              <div key={p.name} className="rounded-2xl border border-border bg-card p-5">
                <p className="text-sm font-medium text-muted-foreground">{p.name}</p>
                <p className="mt-1 text-3xl font-bold tabular-nums">{p.price}</p>
                <p className="text-sm text-muted-foreground">{p.period}, plus 18% GST</p>
                <p className="mt-2 text-sm">Every studio starts with a {TRIAL_DAYS}-day free trial.</p>
              </div>
            ))}
            <div className="rounded-2xl border border-tone-violet/30 bg-tone-violet-soft/40 p-5">
              <p className="text-sm font-semibold text-tone-violet">IPC Diamond member?</p>
              <p className="mt-1 text-sm">
                Start your trial, then verify from your plan with a screenshot of the IPC Diamonds - Premium group. Members get 30 days
                and member prices.
              </p>
            </div>
          </div>
          } />
        </Section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8">
          <p className="text-sm text-foreground/85">
            <Wordmark /> is run by <strong>{LEGAL.operatorName}</strong>, {LEGAL.country}.
            {LEGAL.address.length > 0 && <> {LEGAL.address.join(', ')}.</>}
            {LEGAL.cin && <> CIN {LEGAL.cin}.</>}
            {LEGAL.gstin && <> GSTIN {LEGAL.gstin}.</>}
          </p>
          <p className="text-sm text-muted-foreground">
            Write to us at{' '}
            <a href={`mailto:${LEGAL.supportEmail}`} className="font-medium text-primary hover:underline">
              {LEGAL.supportEmail}
            </a>
            .
          </p>
          <LegalLinks className="justify-start" />
        </div>
      </footer>
    </div>
  )
}

/**
 * Starter, Pro and Studio Max once they are switched on (0242): the same
 * three short cards the studio sees inside, each leading to sign-up. Until
 * then (or if the API cannot be reached) the page keeps today's words.
 */
function PublicPrice({ fallback }: { fallback: ReactNode }) {
  const navigate = useNavigate()
  const plans = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: () => callApi('/public/plans', { responseSchema: plan.array() }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  if (!plans.data || plans.data.length === 0) return <>{fallback}</>
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Every studio starts with a {TRIAL_DAYS}-day free trial. Prices are before 18% GST.</p>
      <PlanPicker plans={plans.data} onChoose={() => void navigate({ to: '/login', search: { mode: 'register' } as never })} />
    </div>
  )
}
