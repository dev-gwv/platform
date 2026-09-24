import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import * as Sentry from '@sentry/react'
import { AlertTriangle, ArrowLeft, Copy, RotateCcw } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { reportClientError } from '@/shared/error/report'

/**
 * What a screen shows when it breaks, instead of the router's bare "Something
 * went wrong!": what happened, in plain words, and three ways on -- try the
 * screen again, go back, or reload. The details can be copied, so a
 * screenshot of this is enough for us to find the cause.
 *
 * It renders where the broken screen was, so the menu and header stay.
 */
export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const text = describe(error)
  return (
    <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-full bg-tone-amber-soft text-tone-amber">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <div>
        <h1 className="text-lg font-semibold">This screen hit a problem</h1>
        <p className="text-sm text-muted-foreground">कुछ गड़बड़ हुई · Nothing you saved is lost.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          onClick={() => {
            reset?.()
            void router.invalidate()
          }}
        >
          <RotateCcw /> Try again
        </Button>
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft /> Go back
        </Button>
        <Button variant="ghost" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-muted-foreground underline">
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <div className="w-full text-left">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px] leading-snug">{text}</pre>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() => void navigator.clipboard?.writeText(`${window.location.href}\n${text}`)}
          >
            <Copy /> Copy details
          </Button>
        </div>
      )}
    </div>
  )
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 8).join('\n')}`
  return String(error)
}

/**
 * Keeps one part of a screen from taking the whole screen down: a panel that
 * fails to draw shows a small note with "Try again", and everything around it
 * keeps working. `resetKey` changing (another item opened) clears it.
 */
export class PanelBoundary extends Component<
  { children: ReactNode; resetKey?: string; label?: string },
  { error: unknown }
> {
  override state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
    reportClientError('error', describe(error), info.componentStack ?? undefined)
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="m-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-5 text-center">
        <p className="text-sm font-medium">Couldn’t show {this.props.label ?? 'this'} · कुछ गड़बड़ हुई</p>
        <p className="max-w-sm break-words text-xs text-muted-foreground">{describe(this.state.error).split('\n')[0]}</p>
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          <RotateCcw /> Try again
        </Button>
      </div>
    )
  }
}
