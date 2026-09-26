import { Card, CardContent } from '@/shared/ui/card'
import { checkpointsFor } from './journey'
import { SetupCheckpoints } from './SetupCheckpoints'

/** "Welcome, Asha" — the first name, or nothing when there is none to take. */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * The welcome a brand-new studio sees once, at the top of step 1, before it
 * has anyone on its team. Three checkpoints and one line about what to do
 * now. No button: the two ways to add people sit right under it.
 */
export function SetupWelcome({ name }: { name: string | null | undefined }) {
  const first = firstName(name)
  return (
    <Card className="mx-auto mb-4 w-full max-w-2xl border-primary/25 bg-primary/5">
      <CardContent className="p-4 sm:p-5">
        <h1 className="text-lg font-semibold tracking-tight">
          Welcome to IPC Studios{first ? `, ${first}` : ''}.
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Three quick steps and your studio runs on autopilot.
        </p>
        <SetupCheckpoints steps={checkpointsFor(1)} className="mt-3" />
        <p className="mt-3 text-sm">Start with your team. It takes about a minute.</p>
      </CardContent>
    </Card>
  )
}
