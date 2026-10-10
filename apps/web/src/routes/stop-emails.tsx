import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Card, CardContent } from '@/shared/ui/card'

/**
 * "Stop these emails" from an email's footer: the onboarding emails
 * (/stop-emails?c=<studio>&t=<signature>) or the morning email
 * (/stop-emails?m=<person>&t=<signature>) or the Monday email
 * (/stop-emails?w=<person>&t=<signature>). One press already happened in the
 * inbox, so this page just does it and says so.
 */
export function StopEmailsPage() {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')
  const params = new URLSearchParams(window.location.search)
  const personal = params.has('m') || params.has('w')
  const which = params.has('w') ? 'Monday emails' : 'morning emails'

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const c = q.get('c')
    const m = q.get('m')
    const w = q.get('w')
    const t = q.get('t')
    if ((!c && !m && !w) || !t) {
      setState('failed')
      return
    }
    callApi(w ? '/public/weekly-email/stop' : m ? '/public/morning-email/stop' : '/public/onboarding-emails/stop', {
      method: 'POST',
      body: w ? { u: w, t } : m ? { u: m, t } : { c, t },
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
            {state === 'working'
              ? 'One moment…'
              : state === 'done'
                ? personal
                  ? `Done. No more ${which}.`
                  : 'Done. No more setup emails.'
                : 'This link did not work.'}
          </p>
          {state === 'done' && (
            <p className="text-sm text-muted-foreground">
              {personal ? 'You can turn it back on from your profile.' : 'Your studio and everything in it are untouched.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
