import { useQuery } from '@tanstack/react-query'
import {
  deliveryReport,
  moneyReport,
  salesReport,
  teamReport,
  type ReportQuery,
  type ReportTab,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

/**
 * Which tabs this person may open. The API checks the same thing again:
 *   Sales, Delivery -- Reports
 *   Money           -- Reports and a money module (financials or money)
 *   Team            -- Reports, or Team Directory
 */
export function useReportTabs(): Record<ReportTab, boolean> {
  const access = useAccess()
  const reports = access.hasModule('reports')
  return {
    sales: reports,
    money: reports && (access.hasModule('financials') || access.hasModule('money')),
    delivery: reports,
    team: reports || access.hasModule('team_directory'),
  }
}

const SCHEMA = { sales: salesReport, money: moneyReport, delivery: deliveryReport, team: teamReport } as const

function useReport<T extends ReportTab>(tab: T, q: ReportQuery, enabled: boolean) {
  const { session } = useAuth()
  const params = new URLSearchParams({ from: q.from, to: q.to })
  return useQuery({
    queryKey: ['reports', tab, q.from, q.to],
    queryFn: () => callApi(`/reports/${tab}?${params.toString()}`, { responseSchema: SCHEMA[tab] }),
    enabled: enabled && !!session,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export const useSalesReport = (q: ReportQuery, enabled: boolean) => useReport('sales', q, enabled)
export const useMoneyReport = (q: ReportQuery, enabled: boolean) => useReport('money', q, enabled)
export const useDeliveryReport = (q: ReportQuery, enabled: boolean) => useReport('delivery', q, enabled)
export const useTeamReport = (q: ReportQuery, enabled: boolean) => useReport('team', q, enabled)
