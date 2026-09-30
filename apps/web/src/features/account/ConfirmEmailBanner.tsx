import { useState } from 'react'
import { MailCheck, X } from 'lucide-react'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const ok = z.object({ ok: z.boolean() })
const HIDE_KEY = 'ipc:confirm-email-hidden'

/**
 * The owner is let in straight after sign-up; confirming the email is asked
 * for here instead, one quiet line with a Resend. Closing it hides it for
 * this browser session only -- it returns until the email is confirmed.
 */
export function ConfirmEmailBanner() {
  const { session } = useAuth()
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(HIDE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!session || session.email_verified || hidden) return null

  async function resend() {
    if (!session?.email) return
    setBusy(true)
    try {
      await callApi('/auth/resend-verification', { method: 'POST', body: { email: session.email }, responseSchema: ok })
      setSent(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <MailCheck className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Confirm your email.</span>{' '}
        <span className="text-muted-foreground">
          {sent ? `Sent again to ${session.email} — check spam too.` : `We sent a link to ${session.email}.`}
        </span>
      </p>
      {!sent && (
        <button type="button" onClick={() => void resend()} disabled={busy} className="font-medium text-primary hover:underline disabled:opacity-50">
          Resend
        </button>
      )}
      <button
        type="button"
        aria-label="Hide"
        onClick={() => {
          setHidden(true)
          try {
            sessionStorage.setItem(HIDE_KEY, '1')
          } catch {
            /* private mode: hidden for this page only */
          }
        }}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
