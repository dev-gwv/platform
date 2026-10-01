import { Card, CardContent } from '@/shared/ui/card'

/** "Welcome, Asha" — the first name, or nothing when there is none to take. */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * The welcome a brand-new studio sees once, at the top of step 1, before it
 * has anyone on its team. One line about what comes next; the three steps
 * are already in the setup bar above, so they are not repeated here. No
 * button: the two ways to add people sit right under it.
 */
export function SetupWelcome({ name }: { name: string | null | undefined }) {
  const first = firstName(name)
  return (
    <Card className="mx-auto mb-4 w-full max-w-2xl border-primary/25 bg-primary/5">
      <CardContent className="p-4 sm:p-5">
        <h1 className="text-lg font-semibold tracking-tight">
          Welcome to Studio AutoPilot{first ? `, ${first}` : ''}.
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Three quick steps: your team, your first client, your first project. Start with your team below.
        </p>
      </CardContent>
    </Card>
  )
}
