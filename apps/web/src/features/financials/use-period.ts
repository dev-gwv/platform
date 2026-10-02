import { useCallback, useEffect } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useAuth } from '@/shared/auth/AuthProvider'
import { readParam } from '@/shared/hooks/use-url-param'
import { parsePeriodChoice, resolvePeriod, type PeriodChoice } from './period'

interface Stored {
  choice: PeriodChoice
  from?: string
  to?: string
}

const storeKey = (company: string | undefined) => `period:${company ?? 'none'}`

function readStored(company: string | undefined): Stored | null {
  try {
    const raw = localStorage.getItem(storeKey(company))
    if (!raw) return null
    const v = JSON.parse(raw) as Stored
    return parsePeriodChoice(v.choice) ? v : null
  } catch {
    return null
  }
}

function writeStored(company: string | undefined, v: Stored) {
  try {
    localStorage.setItem(storeKey(company), JSON.stringify(v))
  } catch {
    // A private window: the period is still in the address.
  }
}

/**
 * The money pages' period: one choice shared by Invoices, Payments received,
 * Expenses, Profit & Loss and Reports. It lives in the address (`?period=`,
 * and `from`/`to` for Custom) so a link carries it, and is remembered per
 * studio so moving from Payments to Expenses keeps the same month. A page
 * opened with no period picks up the last one used, else This month.
 */
export function usePeriod() {
  const { session } = useAuth()
  const company = session?.company_id
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const navigate = useNavigate()
  const inUrl = parsePeriodChoice(readParam(searchStr, 'period'))
  const stored = inUrl ? null : readStored(company)
  const choice: PeriodChoice = inUrl ?? stored?.choice ?? 'this_month'
  const custom = {
    from: readParam(searchStr, 'from') || stored?.from || '',
    to: readParam(searchStr, 'to') || stored?.to || '',
  }
  const resolved = resolvePeriod(choice, custom)

  const set = useCallback(
    (next: PeriodChoice, range?: { from: string; to: string }) => {
      const r = next === 'custom' ? (range ?? custom) : null
      writeStored(company, { choice: next, ...(r ? { from: r.from, to: r.to } : {}) })
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => {
          const out: Record<string, unknown> = { ...prev, period: next }
          delete out.from
          delete out.to
          if (r?.from) out.from = r.from
          if (r?.to) out.to = r.to
          return out
        },
        replace: true,
      } as never)
    },
    // custom is derived from the address each render
    [company, navigate, custom.from, custom.to],
  )

  // A remembered pick shows in the address too, so a copied link is exact.
  useEffect(() => {
    if (!inUrl && stored) set(stored.choice, stored.choice === 'custom' ? { from: stored.from ?? '', to: stored.to ?? '' } : undefined)
  }, [inUrl])

  return { choice, custom, ...resolved, set }
}

export type UsePeriod = ReturnType<typeof usePeriod>
