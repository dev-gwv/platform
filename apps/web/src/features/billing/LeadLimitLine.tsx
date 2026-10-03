import { Link } from '@tanstack/react-router'
import { usePlanUsage } from './UsageCard'

/**
 * On Leads, once a plan's leads for the year are used (0242): one amber line.
 * Enquiries from forms, Facebook and WhatsApp still come in; only adding by
 * hand or by import waits for an upgrade. Nothing at all before that.
 */
export function LeadLimitLine() {
  const usage = usePlanUsage()
  const limit = usage.data?.limits.leads
  if (limit == null || !usage.data || usage.data.used.leads < limit) return null
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 rounded-md border border-tone-amber/50 bg-tone-amber-soft px-3 py-2 text-sm text-tone-amber">
      <span>
        {usage.data.used.leads} of {limit} leads this {usage.data.period} — enquiries still come in.
      </span>
      <Link to="/subscription" className="font-semibold underline-offset-2 hover:underline">
        Upgrade to add more by hand
      </Link>
    </p>
  )
}
