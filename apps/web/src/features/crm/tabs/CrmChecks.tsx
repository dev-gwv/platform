import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleDashed, AlertTriangle } from 'lucide-react'
import { leadSourceRow, type CrmStatsQuery } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useIntegrations } from '@/features/settings/api'
import { useMetaStatus } from '@/features/facebook/api'
import { useCrmStats } from '../api'

type Tone = 'ok' | 'look' | 'off'

const daysAgo = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null)
const ago = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`)

/**
 * "Is the CRM actually working?" in one place: are leads arriving, is
 * Facebook connected, can the studio send WhatsApp and email, and are the
 * follow-ups being kept. Each line says what it found and the one thing to
 * do; the test lead itself is sent from Lead sources, where it belongs.
 */
export function CrmChecks({ range }: { range: CrmStatsQuery }) {
  const { session } = useAuth()
  const access = useAccess()
  const sources = useQuery({
    queryKey: ['crm', 'sources'],
    queryFn: () => callApi('/crm/sources', { responseSchema: leadSourceRow.array() }),
    enabled: !!session && access.hasModule('lead_sources'),
    staleTime: 30_000,
  })
  const meta = useMetaStatus()
  const integrations = useIntegrations()
  const stats = useCrmStats(range)

  const rows: ReactNode[] = []

  if (access.hasModule('lead_sources')) {
    const active = (sources.data ?? []).filter((s) => s.is_active)
    const last = active.map((s) => s.last_lead_at).filter(Boolean).sort().at(-1) ?? null
    const d = daysAgo(last)
    rows.push(
      active.length === 0 ? (
        <Check key="sources" tone="off" title="Forms and ads" text="Nothing is sending leads in yet." action="Connect one" to="/lead-sources" />
      ) : d !== null && d <= 14 ? (
        <Check key="sources" tone="ok" title="Forms and ads" text={`${active.length} connected · last lead ${ago(d)}.`} />
      ) : (
        <Check
          key="sources"
          tone="look"
          title="Forms and ads"
          text={d === null ? `${active.length} connected, but no lead has come through yet.` : `No lead through them in ${d} days.`}
          action="Send a test lead"
          to="/lead-sources"
        />
      ),
    )

    const m = meta.data
    if (m) {
      const md = daysAgo(m.last_lead_at)
      rows.push(
        !m.connected ? (
          <Check key="meta" tone="off" title="Facebook & Instagram ads" text="Not connected." action="Connect" to="/lead-sources" />
        ) : m.last_error ? (
          <Check key="meta" tone="look" title="Facebook & Instagram ads" text={`Meta said: ${m.last_error}`} action="Reconnect" to="/lead-sources" />
        ) : m.webhook_subscribed_count === 0 ? (
          <Check key="meta" tone="look" title="Facebook & Instagram ads" text="Connected, but no page is set to send its leads." action="Pick pages" to="/lead-sources" />
        ) : (
          <Check
            key="meta"
            tone="ok"
            title="Facebook & Instagram ads"
            text={`${m.webhook_subscribed_count} ${m.webhook_subscribed_count === 1 ? 'page sends' : 'pages send'} leads${md !== null ? ` · last ${ago(md)}` : ''}.`}
          />
        ),
      )
    }
  }

  const items = integrations.data?.items ?? []
  const wa = items.find((i) => i.key === 'whatsapp')
  const email = items.find((i) => i.key === 'email')
  if (wa || email) {
    const missing = [wa && !wa.configured ? 'WhatsApp' : null, email && !email.configured ? 'email' : null].filter(Boolean)
    rows.push(
      missing.length === 0 ? (
        <Check key="send" tone="ok" title="Messages" text="WhatsApp and email can both be sent." />
      ) : (
        <Check key="send" tone="look" title="Messages" text={`${missing.join(' and ')} cannot be sent yet.`} action="Set up" to="/settings/messaging" />
      ),
    )
  }

  const warnings = stats.data?.warnings ?? []
  rows.push(
    warnings.length === 0 ? (
      <Check key="follow" tone="ok" title="Follow-ups" text="Every open lead has a follow-up, and none is late." />
    ) : (
      <Check key="follow" tone="look" title="Follow-ups" text={warnings.join(' ')} action="Open the calls" to="/follow-ups" />
    ),
  )

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-3">
        {rows}
      </CardContent>
    </Card>
  )
}

function Check({ tone, title, text, action, to }: { tone: Tone; title: string; text: string; action?: string; to?: string }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'look' ? AlertTriangle : CircleDashed
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2">
      <Icon className={cn('size-5 shrink-0', tone === 'ok' ? 'text-success' : tone === 'look' ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {action && to && (
        <Link to={to} className="text-sm font-medium text-primary hover:underline">
          {action} →
        </Link>
      )}
    </div>
  )
}
