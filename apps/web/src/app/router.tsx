import type { ReactNode } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  Link,
  Navigate,
  type AnyRoute,
} from '@tanstack/react-router'
import { LoginPage } from '@/routes/login'
import { MyProfilePage } from '@/routes/my-profile'
import { LeavePage } from '@/routes/leave'
import { ContactPage, PrivacyPage, RefundPage, TermsPage } from '@/routes/legal'
import { RouteError } from '@/shared/layout/RouteError'
import { CompleteSetupPage } from '@/routes/complete-setup'
import { VerifyEmailPage } from '@/routes/verify'
import { ResetPasswordPage } from '@/routes/reset-password'
import { AcceptInvitePage } from '@/routes/accept-invite'
import { NoAccountPage } from '@/routes/no-account'
import { PlanExpiredPage } from '@/routes/plan-expired'
import { DashboardPage } from '@/routes/dashboard'
import { ProjectsListPage } from '@/routes/projects/list'
import { NewProjectPage } from '@/routes/projects/new'
import { ProjectDetailPage } from '@/routes/projects/detail'
import { ProjectEditPage } from '@/routes/projects/$id.edit'
import { ProjectQuotationPage } from '@/routes/projects/$id.quotation'
import { ProjectTrackingPage } from '@/routes/project-tracking'
import { LeadSourcesPage } from '@/routes/lead-sources'
import { ShootsPage } from '@/routes/shoots'
import { ClientsListPage } from '@/routes/clients/list'
import { ProductionBoardPage } from '@/routes/production-board'
import { TasksPage } from '@/routes/tasks'
import { TeamAllocationPage } from '@/routes/team-allocation'
import { DataManagementPage } from '@/routes/data-management'
import { MyWorkPage } from '@/routes/my-work'
import { BillingPage } from '@/routes/billing'
import { InvoicesPage } from '@/routes/billing/invoices'
import { PaymentsPage } from '@/routes/billing/payments'
import { PaymentReceiptPage } from '@/routes/billing/payment-receipt'
import { PublicInvoicePage } from '@/routes/public-invoice'
import { ClientPortalInvoicePage, ClientPortalPage, ClientPortalTermsPage } from '@/routes/client-portal'
import { InvoiceDetailPage } from '@/routes/invoice-detail'
import { CompanyExpensesPage } from '@/routes/company-expenses'
import { FinancialsPage } from '@/routes/financials'
import { FollowUpsPage } from '@/routes/follow-ups'
import { CrmSetupPage } from '@/routes/follow-ups/setup'
import { AttendancePage } from '@/routes/attendance'
import { NotificationsPage } from '@/routes/notifications'
import { EmployeesPage } from '@/routes/employees'
import { EmployeeDetailPage } from '@/routes/employees/$id'
import { SubscriptionPage } from '@/routes/subscription'
import { SettingsPage } from '@/routes/settings'
import { DeliveryStagesPage } from '@/routes/delivery-stages'
import { RolesAccessPage } from '@/routes/settings/roles'
import { TeamTermsPage } from '@/routes/settings/team-terms'
import { AppearancePage } from '@/routes/settings/appearance'
import { TermsAcknowledgePage } from '@/routes/terms-acknowledge'
import { QuoteAcceptPage } from '@/routes/quote-accept'
import { TeamTermsAcknowledgePage } from '@/routes/team-terms-acknowledge'
import { QuotationPage } from '@/routes/quotation'
import { ReceiptPage } from '@/routes/receipt'
import { DeliveryPage } from '@/routes/delivery'
import { ReferPage } from '@/routes/refer'
import { ProjectDocumentsPage } from '@/routes/project-documents'
import { TeamWorkPreviewPage } from '@/routes/team-work-preview'
import { PlatformStudiosPage } from '@/routes/platform/studios'
import { PlatformUsagePage } from '@/routes/platform/usage'
import { PlatformFeedbackPage } from '@/routes/platform/feedback'
import { SystemPage } from '@/routes/settings/system'
import { AdvancedSettingsPage } from '@/routes/settings/advanced'
import { TaskBundlesPage } from '@/routes/settings/task-bundles'
import { AttendanceLocationPage } from '@/routes/settings/attendance-location'
import { LookupsPage } from '@/routes/settings/lookups'
import { ReferralsPage } from '@/routes/referrals'
import { ProjectTemplatesPage } from '@/routes/project-templates'
import { TeamPayoutsPage } from '@/routes/team-payouts'
import { PayrollPage } from '@/routes/payroll'
import { PayslipPage } from '@/routes/payslip'
import { RemindersPage } from '@/routes/reminders'
import { ActivityPage } from '@/routes/activity'
import { InvoiceTemplatesPage } from '@/routes/billing/templates'
import { MyTasksPage } from '@/routes/tasks/my'
import { MyShootsPage } from '@/routes/shoots/my'
import { ShootDetailPage } from '@/routes/shoots/$shootId'
import { AttendanceUidPage } from '@/routes/attendance/$uid'
import { AllocationMemberPage } from '@/routes/team-allocation/member/$uid'
import { MyWorkProjectPage } from '@/routes/my-work/project/$projectId'
import { RequireAuth } from '@/shared/auth/guards'
import { AppShell } from '@/shared/layout/AppShell'

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFound,
})

/**
 * The signed-in shell, mounted once.
 *
 * Every authed page used to render its own <RequireAuth><AppShell>, so a
 * navigation tore the whole sidebar down and rebuilt it — resetting anything it
 * held and re-running every mount effect. As a pathless layout route the shell
 * stays put and only the <Outlet/> swaps.
 */
function AuthedShell() {
  return (
    <RequireAuth>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  )
}

/**
 * The same shell with the plan gate lifted — the renewal page has to stay
 * reachable precisely when the plan has lapsed, or the recovery path is behind
 * the thing it recovers from.
 */
function RenewalShell() {
  return (
    <RequireAuth allowExpired>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  )
}

const authedLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  component: AuthedShell,
})

const renewalLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'renewal',
  component: RenewalShell,
})

/** Public: no session, no shell. */
const publicRoute = (path: string, component: () => ReactNode): AnyRoute =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

/** Signed in: the shell is already around it. */
const route = (path: string, component: () => ReactNode): AnyRoute =>
  createRoute({ getParentRoute: () => authedLayout, path, component })

const routeTree = rootRoute.addChildren([
  publicRoute('/login', LoginPage),
  publicRoute('/complete-setup', CompleteSetupPage),
  publicRoute('/verify', VerifyEmailPage),
  publicRoute('/reset-password', ResetPasswordPage),
  publicRoute('/accept-invite', AcceptInvitePage),
  publicRoute('/no-account', NoAccountPage),
  publicRoute('/terms/acknowledge', TermsAcknowledgePage),
  publicRoute('/quote/accept', QuoteAcceptPage),
  publicRoute('/team-terms', TeamTermsAcknowledgePage),
  publicRoute('/quotation', QuotationPage),
  publicRoute('/receipt', ReceiptPage),
  publicRoute('/invoice', PublicInvoicePage),
  publicRoute('/delivery', DeliveryPage),
  publicRoute('/refer/$slug', ReferPage),
  // The client portal: one private link per project (0184).
  publicRoute('/p/$token', ClientPortalPage),
  publicRoute('/p/$token/invoice/$invoiceId', ClientPortalInvoicePage),
  publicRoute('/p/$token/terms/$docId', ClientPortalTermsPage),
  // The vendor's policy pages (payment-gateway requirement).
  publicRoute('/terms-and-conditions', TermsPage),
  publicRoute('/privacy-policy', PrivacyPage),
  publicRoute('/refund-policy', RefundPage),
  publicRoute('/contact-us', ContactPage),

  renewalLayout.addChildren([
    createRoute({
      getParentRoute: () => renewalLayout,
      path: '/settings/subscription',
      component: SubscriptionPage,
    }),
    createRoute({
      getParentRoute: () => renewalLayout,
      path: '/plan-expired',
      component: PlanExpiredPage,
    }),
  ]),

  authedLayout.addChildren([
  route('/', DashboardPage),
  route('/dashboard', DashboardPage),

  route('/projects', ProjectsListPage),
  route('/projects/new', NewProjectPage),
  route('/projects/$id', ProjectDetailPage),
  route('/projects/$id/edit', ProjectEditPage),
  route('/projects/$id/quotation', ProjectQuotationPage),
  route('/project-tracking', ProjectTrackingPage),
  route('/project-documents', ProjectDocumentsPage),
  route('/team/work-preview', TeamWorkPreviewPage),
  route('/clients', ClientsListPage),

  route('/shoots', ShootsPage),
  route('/shoots/my', MyShootsPage),
  route('/shoots/$shootId', ShootDetailPage),
  route('/tasks', TasksPage),
  route('/tasks/my', MyTasksPage),
  route('/my-work', MyWorkPage),
  route('/profile', MyProfilePage),
  route('/leave', LeavePage),
  route('/my-work/project/$projectId', MyWorkProjectPage),
  route('/production-board', ProductionBoardPage),
  route('/data-management', DataManagementPage),
  // The old app split each of these consolidated screens into pages of its
  // own. The screen is the same one; the alias only decides which part of it
  // you land on, so an old bookmark still goes somewhere useful.
  route('/data-management/locations', () => <DataManagementPage initialTab="locations" />),
  route('/team-allocation', TeamAllocationPage),
  route('/team-allocation/calendar', () => <TeamAllocationPage initialTab="calendar" />),
  route('/team-allocation/conflicts', () => <TeamAllocationPage initialTab="conflicts" />),
  route('/team-allocation/member/$uid', AllocationMemberPage),
  route('/follow-ups', FollowUpsPage),
  // Everything a studio sets once and never opens again.
  route('/follow-ups/setup', CrmSetupPage),
  route('/lead-sources', LeadSourcesPage),
  // The permissions matrix has declared /facebook as this module's path since
  // Phase 2; keep it working rather than breaking anyone's bookmark.
  route('/facebook', LeadSourcesPage),
  route('/employees', EmployeesPage),
  route('/employees/$id', EmployeeDetailPage),
  route('/attendance', AttendancePage),
  route('/attendance/my', () => <AttendancePage initialTab="mine" />),
  route('/attendance/$uid', AttendanceUidPage),
  route('/billing', BillingPage),
  route('/billing/invoices', InvoicesPage),
  route('/billing/payments', PaymentsPage),
  route('/billing/payments/$id', PaymentReceiptPage),
  route('/billing/templates', () => <Navigate to="/settings/invoicing" replace />),
  route('/billing/settings', () => <Navigate to="/settings/invoicing" replace />),
  route('/billing/invoices/new', () => <InvoicesPage newInvoice />),
  route('/billing/invoices/$id', InvoiceDetailPage),
  route('/billing/invoices/$id/edit', () => <InvoiceDetailPage edit />),
  // The old app's receipt address, kept so saved links still open the receipt.
  route('/billing/$id/invoice', PaymentReceiptPage),
  route('/company-expenses', CompanyExpensesPage),
  route('/company-expenses/report', CompanyExpensesPage),
  route('/financials', FinancialsPage),
  // The two older profit screens now live in Profit & Loss.
  route('/financials/profit', () => <Navigate to="/financials" replace />),
  route('/financials/reconciliation', () => <Navigate to="/billing/payments" replace />),
  route('/financials/calculated-expenses', () => <Navigate to="/financials" replace />),
  route('/notifications', NotificationsPage),
  route('/notifications/generate', () => <NotificationsPage generate />),
  route('/projects/stages', DeliveryStagesPage),
  route('/settings/company', SettingsPage),
  route('/settings/roles', RolesAccessPage),
  route('/settings/team-terms', TeamTermsPage),
  route('/settings/task-bundles', TaskBundlesPage),
  route('/settings/attendance-location', AttendanceLocationPage),
  route('/settings/lookups', LookupsPage),
  route('/settings/advanced', AdvancedSettingsPage),
  route('/personal-expenses', () => <Navigate to="/company-expenses" replace />),
  route('/settings/invoicing', InvoiceTemplatesPage),
  route('/settings/appearance', AppearancePage),
  route('/settings/system', SystemPage),
  route('/settings/services', () => <SystemPage focus="services" />),
  route('/settings/work-submissions', () => <SystemPage focus="work-submissions" />),
  route('/referrals', ReferralsPage),
  route('/settings/project-templates', ProjectTemplatesPage),
  route('/team-payouts', TeamPayoutsPage),
  route('/payroll', PayrollPage),
  route('/payroll/payslip/$lineId', PayslipPage),
  route('/reminders', RemindersPage),
  route('/activity', ActivityPage),
  route('/platform/studios', PlatformStudiosPage),
  route('/platform/usage', PlatformUsagePage),
  route('/platform/feedback', PlatformFeedbackPage),
  ]),
])

export const router = createRouter({
  routeTree,
  // A screen that breaks says so in plain words, with a way on, and keeps the
  // menu around it -- never the bare "Something went wrong!".
  defaultErrorComponent: RouteError,
})

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center font-sans">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn’t exist.</p>
      <Link to="/dashboard" className="text-primary hover:underline">
        Go to dashboard
      </Link>
    </div>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
