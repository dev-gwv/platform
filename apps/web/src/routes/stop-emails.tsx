import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Card, CardContent } from '@/shared/ui/card'

/**
 * "Stop these emails" from the onboarding emails' footer
 * (/stop-emails?c=<studio>&t=<signature>). One press already happened in the
 * inbox, so this page just does it and says so.
 */
export function StopEmailsPage() {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const c = q.get('c')
    const t = q.get('t')
    if (!c || !t) {
      setState('failed')
      return
    }
    callApi('/public/onboarding-emails/stop', {
      method: 'POST',
      body: { c, t },
      responseSchema: z.object({ ok: z.boolean() }),
    })
      .then(() => setState('done'))
      .catch(() => setState('failed'))
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          {state === 'working' && <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />}
          {state === 'done' && <CheckCircle2 className="size-8 text-success" aria-hidden />}
          {state === 'failed' && <XCircle className="size-8 text-destructive" aria-hidden />}
          <p className="font-semibold">
            {state === 'working' ? 'One moment…' : state === 'done' ? 'Done. No more setup emails.' : 'This link did not work.'}
          </p>
          {state === 'done' && (
            <p className="text-sm text-muted-foreground">Your studio and everything in it are untouched.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
