import { cn } from './cn'

/**
 * Who made Studio AutoPilot, under the sign-in and sign-up forms (owner, 24
 * Oct: "people should be able to understand that this is Abdullah Ansari's
 * SaaS"). Drawn in the wordmark's navy and gold: a hairline gold rule, a small
 * tracked-out lead-in, the name, and the title in quiet italics.
 */
export function DesignerCredit({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-1.5 text-center', className)}>
      <div className="flex w-full max-w-[14rem] items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#f2a618]/70" />
        <span className="size-1 rotate-45 bg-[#f2a618]" />
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#f2a618]/70" />
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
        Designed &amp; developed by
      </p>
      <p
        className="text-base font-bold tracking-[-0.01em] text-[#1b2a4a] dark:text-foreground"
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}
      >
        Abdullah Ansari <span className="font-medium text-[#b9790a] dark:text-[#f2a618]">&amp; Team</span>
      </p>
      <p className="text-xs italic text-muted-foreground">(India&rsquo;s only Photography Business Coach)</p>
    </div>
  )
}
