import { cn } from './cn'

/**
 * The product's name, drawn the way the welcome email draws it -- the one
 * the owner saw and asked for everywhere: "Studio" in navy and "AutoPilot" in
 * gold, run together, heavy and tight, in the system's own sans so it looks
 * the same whatever font a studio picks for its theme. `compact` is the
 * collapsed sidebar's two-letter mark.
 */
export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cn('whitespace-nowrap font-extrabold tracking-[-0.02em]', className)}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}
    >
      <span className="text-[#1b2a4a] dark:text-foreground">{compact ? 'S' : 'Studio'}</span>
      <span className="text-[#f2a618]">{compact ? 'A' : 'AutoPilot'}</span>
    </span>
  )
}
