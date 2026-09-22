import { useState } from 'react'
import { Check, ClipboardCheck, Copy } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { config } from '@/shared/config'
import { useMetaConnectUrl } from './api'

/**
 * What still has to be done in the Meta Developer Portal, and the exact values
 * to paste there.
 *
 * The page already said which server secrets were unset, which tells a studio
 * that something is wrong and nothing about how to fix it. Meta's console asks
 * for four values that must match character-for-character, and getting one
 * wrong fails the webhook handshake with no useful error — so they are listed
 * here to copy rather than to retype.
 */
function apiBase(): string {
  const base = config.apiBaseUrl
  if (base.startsWith('http')) return base.replace(/\/+$/, '')
  return `${typeof window === 'undefined' ? '' : window.location.origin}${base}`.replace(/\/+$/, '')
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(value)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

function Row({ done, title, where }: { done: boolean; title: string; where?: string }) {
  return (
    <li className="flex flex-wrap items-start gap-2 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        {where && <span className="block text-xs text-muted-foreground">{where}</span>}
      </span>
      <StatusBadge tone={done ? 'success' : 'warning'}>{done ? 'Done' : 'Needs setup'}</StatusBadge>
    </li>
  )
}

export function MetaSetupChecklist() {
  const connectUrl = useMetaConnectUrl()
  const missing = connectUrl.data?.missing_config ?? []
  const has = (k: string) => !missing.includes(k)

  const api = apiBase()
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const webhook = `${api}/webhooks/meta`
  const redirect = connectUrl.data?.redirect_uri ?? `${api}/meta/callback`
  const domains = [origin, api]
    .map((u) => {
      try {
        return new URL(u).host
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join(', ')

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <p className="flex items-center gap-2 font-semibold tracking-tight">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          Meta setup checklist
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Paste these into your Meta Developer Portal exactly as they appear — Meta matches them
          character for character, and a mismatch fails the webhook handshake without saying why.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CopyRow label="Webhook callback URL" value={webhook} />
          <CopyRow label="OAuth redirect URI" value={redirect} />
          <CopyRow label="Website URL" value={origin} />
          <CopyRow label="App domains" value={domains} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Built in this app
            </p>
            <ul className="mt-1 divide-y divide-border">
              <Row done title="Lead webhook endpoint deployed" />
              <Row done title="Meta verification handshake handled" />
              <Row done title="Leads mirrored into the CRM on arrival" />
              <Row done title="Page connect and disconnect" />
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              In the Meta portal
            </p>
            <ul className="mt-1 divide-y divide-border">
              <Row
                done={has('META_APP_ID')}
                title={
                  connectUrl.data?.app_id
                    ? `Confirm Meta App ID: ${connectUrl.data.app_id}`
                    : 'Set the Meta App ID on the server'
                }
                where="Meta → App → Settings → Basic"
              />
              <Row
                done={has('META_APP_SECRET')}
                title="Add the app secret as a server secret"
                where="META_APP_SECRET — signs every incoming webhook"
              />
              <Row
                done={has('META_VERIFY_TOKEN')}
                title="Set the verify token, and enter the same value in Meta"
                where="Meta → App → Webhooks → Verify Token. The value must match exactly."
              />
              <Row
                done={has('META_PAGE_ACCESS_TOKEN')}
                title="Add a page access token"
                where="Without it a lead arrives as an id with no name or phone attached."
              />
              <Row done={false} title="Add the OAuth redirect URI above" where="Meta → App → Facebook Login → Settings" />
              <Row done={false} title="Add the app domains and website URL above" where="Meta → App → Settings → Basic" />
              <Row done={false} title="Subscribe the page to the leadgen field" where="Meta → App → Webhooks → Page → leadgen" />
            </ul>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          The last three cannot be checked from here — Meta does not expose whether they are set, so
          they stay listed as a reminder rather than being reported as done.
        </p>
      </CardContent>
    </Card>
  )
}
