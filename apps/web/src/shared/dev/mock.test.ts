import { describe, expect, it } from 'vitest'
import {
  assistantState,
  attendancePlace,
  attendanceRule,
  billingDue,
  billingOverview,
  branding,
  callQueueItem,
  callQueueScope,
  companyTaskPriority,
  crmTag,
  dayReport,
  dayReportRow,
  deliveryReport,
  entitlementsResponse,
  expense,
  expenseSummary,
  fbConnectUrlResponse,
  fbPage,
  fbStatusResponse,
  fixedOverhead,
  gstSummary,
  invoiceBankAccountList,
  invoiceItemPreset,
  invoiceListItem,
  invoiceListResponse,
  invoiceNoteTemplateList,
  invoiceTemplateList,
  learnSignals,
  memberScorecardHistory,
  moneyReport,
  monthlySalaryList,
  myAttendanceToday,
  myProfile,
  payoutSettlementList,
  projectBilling,
  projectCostSheet,
  projectTemplateList,
  projectTrackingRow,
  receivedPaymentListResponse,
  salesReport,
  scorecardTeamRow,
  sequenceSend,
  shootListItem,
  subscriptionStatus,
  taskRoutine,
  teamMember,
  teamPayoutList,
  teamProfileGap,
  teamReport,
  teamSlot,
  userHints,
  welcomeResult,
  whatsappStatus,
  workReminderSettings,
  z,
  platformDiamondClaim,
  diamondSheetStatus,
  diamondMiss,
  emailHealth,
  platformUsage,
  flowStopList,
  healthBody,
} from '@ipc/contracts'
import { NOT_MOCKED } from './mock-flag'
import { mockResponse } from './mock'

// The schemas the callers wrap locally, rebuilt the same way.
const queueResponse = z.object({ scope: callQueueScope, items: callQueueItem.array() })
const crmTeamResponse = z.object({ day: z.string(), items: dayReportRow.array() })
const perfTeamResponse = z.object({ from: z.string(), to: z.string(), items: scorecardTeamRow.array() })
const expensePage = z.object({ items: expense.array(), total: z.number().int(), page: z.number().int(), page_size: z.number().int() })
const shootTypeItem = z.object({ id: z.string().uuid(), name: z.string(), category: z.string().nullable().default(null), usage_count: z.number().int().default(0), is_archived: z.boolean().default(false) })
const ok = z.object({ ok: z.boolean() })
const emailSwitch = z.object({ on: z.boolean(), applies: z.boolean().default(true) })

const P1 = '00000091-0000-4000-8000-000000000000'
const U1 = '000000e1-0000-4000-8000-000000000000'

const table: [string, string, z.ZodTypeAny, unknown?][] = [
  ['GET', '/hr/attendance/me', myAttendanceToday],
  ['GET', '/hr/places', attendancePlace.array()],
  ['GET', '/hr/rules', attendanceRule.array()],
  ['GET', '/features/branding', branding],
  ['GET', '/features', entitlementsResponse],
  ['GET', '/auth/hints', userHints],
  ['PUT', '/auth/hints/getting_started', userHints, { value: { shown: 2, closed: false } }],
  ['PUT', '/auth/hints/learn', userHints, { value: { watched: [], closed: [] } }],
  ['PUT', '/auth/hints/assistant_lang', userHints, { value: { lang: 'hi' } }],
  ['GET', '/auth/learn', learnSignals],
  ['POST', '/auth/welcome', welcomeResult],
  ['POST', '/activity/track', ok, { route: '/', module: 'dashboard', event_name: 'route_viewed', session_id: 's' }],
  ['GET', '/subscription/status', subscriptionStatus],
  ['GET', '/assistant/state', assistantState],
  ['GET', '/allocation', teamSlot.array()],
  ['GET', '/allocation?from=2026-11-01&to=2026-11-30', teamSlot.array()],
  ['GET', `/allocation?user_id=${U1}&from=2026-11-17`, teamSlot.array()],
  ['GET', '/shoots?from=2026-11-01&to=2026-11-30', shootListItem.array()],
  ['GET', '/team/members', teamMember.array()],
  ['GET', '/crm/queue?scope=mine', queueResponse],
  ['GET', '/crm/queue?scope=all', queueResponse],
  ['GET', '/crm/queue/day', dayReport],
  ['GET', `/crm/queue/day?user=${U1}`, dayReport],
  ['GET', '/crm/queue/team', crmTeamResponse],
  ['GET', '/crm/sequences/sends', z.object({ items: sequenceSend.array() })],
  ['GET', '/crm/tags', crmTag.array()],
  ['GET', '/billing/due?from=2026-11-01&to=2026-11-30', billingDue],
  ['GET', '/billing/payments?page=1&page_size=25&from=2026-11-01&to=2026-11-30', receivedPaymentListResponse],
  ['GET', '/billing/overview', billingOverview],
  ['GET', '/billing/invoices', invoiceListItem.array()],
  ['GET', '/billing/invoices?page=1&page_size=25', invoiceListResponse],
  ['GET', '/billing/templates', invoiceTemplateList],
  ['GET', '/billing/bank-accounts', invoiceBankAccountList],
  ['GET', '/billing/note-templates', invoiceNoteTemplateList],
  ['GET', '/billing/items', z.array(invoiceItemPreset)],
  ['GET', '/tasks/priorities', companyTaskPriority.array()],
  ['GET', '/tasks/routines', taskRoutine.array()],
  ['GET', '/tasks/routines?mine=1', taskRoutine.array()],
  ['GET', '/financials/expenses?page=1&page_size=25&from=2026-11-01&to=2026-11-30', expensePage],
  ['GET', `/financials/expenses?project_id=${P1}`, expense.array()],
  ['GET', '/financials/expenses/summary', expenseSummary],
  ['GET', '/financials/expenses/summary?reimbursement=pending', expenseSummary],
  ['GET', '/financials/gst-summary?from=2026-11-01&to=2026-11-30', gstSummary],
  ['GET', '/financials/fixed-overheads', fixedOverhead.array()],
  ['GET', '/financials/fixed-overheads?month=2026-11', fixedOverhead.array()],
  ['GET', '/team-payouts', teamPayoutList],
  ['GET', '/team-payouts?status=pending', teamPayoutList],
  ['GET', '/team-payouts/settlements', payoutSettlementList],
  ['GET', '/team/profile-gaps', teamProfileGap.array()],
  ['GET', '/team/monthly-salaries?year=2026&month=11', monthlySalaryList],
  ['GET', '/performance', perfTeamResponse],
  ['GET', '/performance?month=2026-11', perfTeamResponse],
  ['GET', '/performance/me', memberScorecardHistory],
  ['GET', `/performance/members/${U1}`, memberScorecardHistory],
  ['GET', '/reports/sales?from=2026-11-01&to=2026-11-30', salesReport],
  ['GET', '/reports/money?from=2026-11-01&to=2026-11-30', moneyReport],
  ['GET', '/reports/delivery?from=2026-11-01&to=2026-11-30', deliveryReport],
  ['GET', '/reports/team?from=2026-11-01&to=2026-11-30', teamReport],
  ['GET', '/meta/status', fbStatusResponse],
  ['GET', '/meta/connect-url', fbConnectUrlResponse],
  ['GET', '/meta/pages', fbPage.array()],
  ['GET', '/whatsapp', whatsappStatus],
  ['GET', '/work/reminder-settings', workReminderSettings],
  ['GET', '/settings/profile', myProfile],
  ['GET', '/projects/tracking', projectTrackingRow.array()],
  ['GET', '/projects/templates', projectTemplateList],
  ['GET', `/projects/${P1}/billing`, projectBilling],
  ['GET', `/projects/${P1}/costs`, projectCostSheet],
  ['GET', '/projects/catalog/shoot-types', shootTypeItem.array()],
  ['GET', '/health', healthBody],
  ['GET', '/settings/morning-email', emailSwitch],
  ['GET', '/settings/weekly-email', emailSwitch],
  ['GET', '/platform/diamond', platformDiamondClaim.array()],
  ['GET', '/platform/diamond/sheet', diamondSheetStatus],
  ['GET', '/platform/diamond/misses', diamondMiss.array()],
  ['GET', '/platform/email', emailHealth],
  ['GET', '/platform/usage?days=30', platformUsage],
  ['GET', '/platform/usage/stuck?days=30', flowStopList],
]

describe('preview mock answers fit their contracts', () => {
  it.each(table)('%s %s', (method, path, schema, body) => {
    const out = mockResponse(path, method, body)
    expect(out, `${method} ${path} is not mocked`).not.toBe(NOT_MOCKED)
    const r = schema.safeParse(out)
    if (!r.success) console.error(`${method} ${path}`, JSON.stringify(r.error.issues.slice(0, 8), null, 2))
    expect(r.success).toBe(true)
  })

  it('keeps the assistant button hidden', () => {
    expect((mockResponse('/assistant/state', 'GET') as { enabled: boolean }).enabled).toBe(false)
  })
})
