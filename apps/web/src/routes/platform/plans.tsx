import { Link } from '@tanstack/react-router'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { Switch } from '@/shared/ui/switch'
import { usePlatformPlanCounts, usePlatformPlans, useSetPlanOnSale } from '@/features/platform/api'
import { byAudience, limitWords, planLabel, priceWords } from '@/features/platform/plan-rows'

export function PlatformPlansPage() {
  return (
    <PlatformPage>
      <Plans />
    </PlatformPage>
  )
}

/**
 * Every plan in one place (owner, 10 Oct: "we need to show the plans at the
 * backend"): who it is for, its price and limits, how many studios are on it
 * now, and a switch to put it on sale or take it off. Giving a studio a plan
 * stays in Studio Access Manager, where the studio is.
 */
function Plans() {
  const plans = usePlatformPlans()
  const counts = usePlatformPlanCounts()
  const onSale = useSetPlanOnSale()

  if (plans.isLoading) {
    return (
      <>
        <PageHeader title="Plans" />
        <SkeletonList rows={6} columns={4} />
      </>
    )
  }
  if (plans.isError || !plans.data) {
    return (
      <>
        <PageHeader title="Plans" />
        <ErrorState onRetry={() => void plans.refetch()} />
      </>
    )
  }

  const groups = byAudience(plans.data)
  const live = plans.data.filter((p) => p.is_active).length
  const bars = [
    ...plans.data.filter((p) => p.is_active || (p.studios ?? 0) > 0).map((p) => ({ key: p.key, label: planLabel(p), n: p.studios ?? 0, trial: false })),
    ...(counts.data ? [{ key: 'trial', label: 'Free trial', n: counts.data.on_trial, trial: true }] : []),
  ]
  const most = Math.max(1, ...bars.map((b) => b.n))

  return (
    <>
      <PageHeader title="Plans" />
      <p className="mb-4 text-sm text-muted-foreground">
        {live} plan{live === 1 ? '' : 's'} on sale.
        {counts.data && ` ${counts.data.paying} studio${counts.data.paying === 1 ? ' is' : 's are'} paying and ${counts.data.on_trial} ${counts.data.on_trial === 1 ? 'is' : 'are'} on a free trial.`}
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Price</th>
                  <th className="px-3 py-2.5 font-medium">Limits</th>
                  <th className="px-3 py-2.5 text-right font-medium">Studios</th>
                  <th className="px-3 py-2.5 font-medium">On sale</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  <tr>
                    <td colSpan={5} className="bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      {g.label}
                    </td>
                  </tr>
                  {g.plans.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2.5 font-medium">{p.name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{priceWords(p)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{limitWords(p)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.studios ?? 0}</td>
                      <td className="px-3 py-2.5">
                        <Switch
                          checked={p.is_active}
                          disabled={onSale.isPending}
                          onChange={(next) => onSale.mutate({ key: p.key, name: p.name, onSale: next })}
                          label={p.is_active ? 'On sale' : 'Off'}
                          className="w-auto whitespace-nowrap"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-sm font-semibold">Studios on each plan</p>
            <ul className="flex flex-col gap-2">
              {bars.map((b) => (
                <li
                  key={b.key}
                  className="grid grid-cols-[8.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-sm"
                  title={`${b.label}: ${b.n} studio${b.n === 1 ? '' : 's'}`}
                >
                  <span className={b.trial ? 'truncate text-muted-foreground' : 'truncate'}>{b.label}</span>
                  <span className="h-4">
                    <span
                      className={`block h-full rounded-r ${b.trial ? 'bg-muted-foreground/40' : 'bg-primary'}`}
                      style={{ width: `${Math.max(b.n ? 2 : 0, (b.n / most) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">{b.n}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              To give a studio a plan, open{' '}
              <Link to="/platform/studios" className="font-medium text-primary hover:underline">
                Studio Access Manager
              </Link>{' '}
              → Actions → Assign / change plan.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
