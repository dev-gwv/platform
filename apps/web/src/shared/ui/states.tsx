import type { ReactNode } from 'react'
import { Button } from './button'
import { ApiError } from '../api/client'

/**
 * The failure of a page or panel. Pass the caught error and the reference id
 * the API stamped on it is shown too — the one line support can find in the
 * logs without asking what time it happened.
 */
export function ErrorState({
  message,
  error,
  onRetry,
}: {
  message?: string
  error?: unknown
  onRetry?: () => void
}) {
  // Only an ApiError's message came from the server meant for a person to read.
  // Anything else — a schema mismatch, a network TypeError — carries a message
  // written for a developer, so it falls back to a generic line instead.
  const text = message ?? (error instanceof ApiError ? error.message : error ? 'Something went wrong. Please try again.' : undefined)
  const reference = error instanceof ApiError ? error.correlationId : null
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center" role="alert">
      <p className="font-medium">This didn’t load</p>
      {text && <p className="max-w-sm text-sm text-muted-foreground">{text}</p>}
      {reference && (
        <p className="font-mono text-xs text-muted-foreground">Reference: {reference}</p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}
