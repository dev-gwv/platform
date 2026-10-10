import { useEffect } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  Link,
  Navigate,
  useNavigate,
  lazyRouteComponent,
  type AnyRoute,
  type RouteComponent,
} from '@tanstack/react-router'
import { RouteError } from '@/shared/layout/RouteError'
import { LEGACY_AUTHED_PATHS, LEGACY_PUBLIC_PATHS, legacyTarget } from './legacy-links'
import { RequireAuth } from '@/shared/auth/guards'
import { AppShell } from '@/shared/layout/AppShell'

// Each page is its own chunk, loaded when it is opened: the first load used to
// carry the whole studio app (3.25 MB), client links and enquiry forms included.
const LoginPage = lazyRouteComponent(() => import('@/routes/login'), 'LoginPage')
const HomePage = lazyRouteComponent(() => import('@/routes/home'), 'HomePage')
const MyProfilePage = lazyRouteComponent(() => import('@/routes/my-profile'), 'MyProfilePage')
const LeavePage = lazyRouteComponent(() => import('@/routes/leave'), 'LeavePage')
const ContactPage = lazyRouteComponent(() => import('@/routes/legal'), 'ContactPage')
const DataDeletionPage = lazyRouteComponent(() => import('@/routes/legal'), 'DataDeletionPage')
const PrivacyPage = lazyRouteComponent(() => import('@/routes/legal'), 'PrivacyPage')
const RefundPage = lazyRouteComponent(() => import('@/routes/legal'), 'RefundPage')
const TermsPage = lazyRouteComponent(() => import('@/routes/legal'), 'TermsPage')
const HelpSetupPage = lazyRouteComponent(() => import('@/routes/help-setup'), 'HelpSetupPage')
const HelpWhatsAppPage = lazyRouteComponent(() => import('@/routes/help-whatsapp'), 'HelpWhatsAppPage')
const HelpPage = lazyRouteComponent(() => import('@/routes/help'), 'HelpPage')
const LearnPage = lazyRouteComponent(() => import('@/routes/learn'), 'LearnPage')
const CompleteSetupPage = lazyRouteComponent(() => import('@/routes/complete-setup'), 'CompleteSetupPage')
const VerifyEmailPage = lazyRouteComponent(() => import('@/routes/verify'), 'VerifyEmailPage')
const ResetPasswordPage = lazyRouteComponent(() => import('@/routes/reset-password'), 'ResetPasswordPage')
const AcceptInvitePage = lazyRouteComponent(() => import('@/routes/accept-invite'), 'AcceptInvitePage')
const NoAccountPage = lazyRouteComponent(() => import('@/routes/no-account'), 'NoAccountPage')
const PlanExpiredPage = lazyRouteComponent(() => import('@/routes/plan-expired'), 'PlanExpiredPage')
const DashboardPage = lazyRouteComponent(() => import('@/routes/dashboard'), 'DashboardPage')
const ProjectsListPage = lazyRouteComponent(() => import('@/routes/projects/list'), 'ProjectsListPage')
const NewProjectPage = lazyRouteComponent(() => import('@/routes/projects/new'), 'NewProjectPage')
const ProjectDetailPage = lazyRouteComponent(() => import('@/routes/projects/detail'), 'ProjectDetailPage')
const ProjectEditPage = lazyRouteComponent(() => import('@/routes/projects/$id.edit'), 'ProjectEditPage')
const ProjectQuotationPage = lazyRouteComponent(() => import('@/routes/projects/$id.quotation'), 'ProjectQuotationPage')
const ProjectTrackingPage = lazyRouteComponent(() => import('@/routes/project-tracking'), 'ProjectTrackingPage')
const LeadSourcesPage = lazyRouteComponent(() => import('@/routes/lead-sources'), 'LeadSourcesPage')
const ClientsListPage = lazyRouteComponent(() => import('@/routes/clients/list'), 'ClientsListPage')
const ProductionBoardPage = lazyRouteComponent(() => import('@/routes/production-board'), 'ProductionBoardPage')
const TasksPage = lazyRouteComponent(() => import('@/routes/tasks'), 'TasksPage')
const TeamAllocationPage = lazyRouteComponent(() => import('@/routes/team-allocation'), 'TeamAllocationPage')
const DataManagementPage = lazyRouteComponent(() => import('@/routes/data-management'), 'DataManagementPage')
const MyWorkPage = lazyRouteComponent(() => import('@/routes/my-work'), 'MyWorkPage')
const BillingPage = lazyRouteComponent(() => import('@/routes/billing'), 'BillingPage')
const InvoicesPage = lazyRouteComponent(() => import('@/routes/billing/invoices'), 'InvoicesPage')
const PaymentsPage = lazyRouteComponent(() => import('@/routes/billing/payments'), 'PaymentsPage')
const PaymentReceiptPage = lazyRouteComponent(() => import('@/routes/billing/payment-receipt'), 'PaymentReceiptPage')
const PublicInvoicePage = lazyRouteComponent(() => import('@/routes/public-invoice'), 'PublicInvoicePage')
const StopEmailsPage = lazyRouteComponent(() => import('@/routes/stop-emails'), 'StopEmailsPage')
const ClientPortalInvoicePage = lazyRouteComponent(() => import('@/routes/client-portal'), 'ClientPortalInvoicePage')
const ClientPortalPage = lazyRouteComponent(() => import('@/routes/client-portal'), 'ClientPortalPage')
const ClientPortalTermsPage = lazyRouteComponent(() => import('@/routes/client-portal'), 'ClientPortalTermsPage')
const ClientPortalPreviewPage = lazyRouteComponent(() => import('@/routes/client-portal-preview'), 'ClientPortalPreviewPage')
const InvoiceDetailPage = lazyRouteComponent(() => import('@/routes/invoice-detail'), 'InvoiceDetailPage')
const CompanyExpensesPage = lazyRouteComponent(() => import('@/routes/company-expenses'), 'CompanyExpensesPage')
const FinancialsPage = lazyRouteComponent(() => import('@/routes/financials'), 'FinancialsPage')
const FollowUpsPage = lazyRouteComponent(() => import('@/routes/follow-ups'), 'FollowUpsPage')
const CrmSetupPage = lazyRouteComponent(() => import('@/routes/follow-ups/setup'), 'CrmSetupPage')
const CrmReportsPage = lazyRouteComponent(() => import('@/routes/follow-ups/reports'), 'CrmReportsPage')
const CallQueuePage = lazyRouteComponent(() => import('@/routes/follow-ups/queue'), 'CallQueuePage')
const SendNowPage = lazyRouteComponent(() => import('@/routes/follow-ups/send'), 'SendNowPage')
const AttendancePage = lazyRouteComponent(() => import('@/routes/attendance'), 'AttendancePage')
const MyAttendancePage = lazyRouteComponent(() => import('@/routes/attendance'), 'MyAttendancePage')
const MyPerformancePage = lazyRouteComponent(() => import('@/routes/performance'), 'MyPerformancePage')
const TeamPerformancePage = lazyRouteComponent(() => import('@/routes/performance'), 'TeamPerformancePage')
const MyPayoutsPage = lazyRouteComponent(() => import('@/routes/my-payouts'), 'MyPayoutsPage')
const NotificationsPage = lazyRouteComponent(() => import('@/routes/notifications'), 'NotificationsPage')
const EmployeesPage = lazyRouteComponent(() => import('@/routes/employees'), 'EmployeesPage')
const TeamSalariesPage = lazyRouteComponent(() => import('@/routes/team-salaries'), 'TeamSalariesPage')
const EmployeeDetailPage = lazyRouteComponent(() => import('@/routes/employees/$id'), 'EmployeeDetailPage')
const SubscriptionPage = lazyRouteComponent(() => import('@/routes/subscription'), 'SubscriptionPage')
const SettingsPage = lazyRouteComponent(() => import('@/routes/settings'), 'SettingsPage')
const DeliveryStagesPage = lazyRouteComponent(() => import('@/routes/delivery-stages'), 'DeliveryStagesPage')
const RolesAccessPage = lazyRouteComponent(() => import('@/routes/settings/roles'), 'RolesAccessPage')
const TeamTermsPage = lazyRouteComponent(() => import('@/routes/settings/team-terms'), 'TeamTermsPage')
const AppearancePage = lazyRouteComponent(() => import('@/routes/settings/appearance'), 'AppearancePage')
const TermsAcknowledgePage = lazyRouteComponent(() => import('@/routes/terms-acknowledge'), 'TermsAcknowledgePage')
const QuoteAcceptPage = lazyRouteComponent(() => import('@/routes/quote-accept'), 'QuoteAcceptPage')
const TeamTermsAcknowledgePage = lazyRouteComponent(() => import('@/routes/team-terms-acknowledge'), 'TeamTermsAcknowledgePage')
const QuotationPage = lazyRouteComponent(() => import('@/routes/quotation'), 'QuotationPage')
const ReceiptPage = lazyRouteComponent(() => import('@/routes/receipt'), 'ReceiptPage')
const DeliveryPage = lazyRouteComponent(() => import('@/routes/delivery'), 'DeliveryPage')
const ReferPage = lazyRouteComponent(() => import('@/routes/refer'), 'ReferPage')
const EnquirePage = lazyRouteComponent(() => import('@/routes/enquire'), 'EnquirePage')
const EnquiryViewPage = lazyRouteComponent(() => import('@/routes/enquire'), 'EnquiryViewPage')
const ClientDetailsPage = lazyRouteComponent(() => import('@/routes/client-details'), 'ClientDetailsPage')
const EnquiryFormDetailPage = lazyRouteComponent(() => import('@/routes/enquiry-forms'), 'EnquiryFormDetailPage')
const EnquiryFormsPage = lazyRouteComponent(() => import('@/routes/enquiry-forms'), 'EnquiryFormsPage')
const ProjectDocumentsPage = lazyRouteComponent(() => import('@/routes/project-documents'), 'ProjectDocumentsPage')
const TeamWorkPreviewPage = lazyRouteComponent(() => import('@/routes/team-work-preview'), 'TeamWorkPreviewPage')
const PlatformStudiosPage = lazyRouteComponent(() => import('@/routes/platform/studios'), 'PlatformStudiosPage')
const PlatformUsagePage = lazyRouteComponent(() => import('@/routes/platform/usage'), 'PlatformUsagePage')
const PlatformFeedbackPage = lazyRouteComponent(() => import('@/routes/platform/feedback'), 'PlatformFeedbackPage')
const PlatformDiamondPage = lazyRouteComponent(() => import('@/routes/platform/diamond'), 'PlatformDiamondPage')
const SystemPage = lazyRouteComponent(() => import('@/routes/settings/system'), 'SystemPage')
const MessagingSettingsPage = lazyRouteComponent(() => import('@/routes/settings/messaging'), 'MessagingSettingsPage')
const WhatsappSettingsPage = lazyRouteComponent(() => import('@/routes/settings/whatsapp'), 'WhatsappSettingsPage')
const PlatformMessagingPage = lazyRouteComponent(() => import('@/routes/platform/messaging'), 'PlatformMessagingPage')
const PlatformEmailPage = lazyRouteComponent(() => import('@/routes/platform/email'), 'PlatformEmailPage')
const PlatformPaymentsPage = lazyRouteComponent(() => import('@/routes/platform/payments'), 'PlatformPaymentsPage')
const PlatformPlansPage = lazyRouteComponent(() => import('@/routes/platform/plans'), 'PlatformPlansPage')
const PlatformHelpPage = lazyRouteComponent(() => import('@/routes/platform/help'), 'PlatformHelpPage')
const TaskBundlesPage = lazyRouteComponent(() => import('@/routes/settings/task-bundles'), 'TaskBundlesPage')
const AttendanceLocationPage = lazyRouteComponent(() => import('@/routes/settings/attendance-location'), 'AttendanceLocationPage')
const LookupsPage = lazyRouteComponent(() => import('@/routes/settings/lookups'), 'LookupsPage')
const VendorsPage = lazyRouteComponent(() => import('@/routes/settings/vendors'), 'VendorsPage')
const ClientFormPage = lazyRouteComponent(() => import('@/routes/settings/client-form'), 'ClientFormPage')
const ReferAStudioPage = lazyRouteComponent(() => import('@/routes/settings/refer-a-studio'), 'ReferAStudioPage')
const PlatformStudioReferralsPage = lazyRouteComponent(() => import('@/routes/platform/studio-referrals'), 'PlatformStudioReferralsPage')
const ReferralsPage = lazyRouteComponent(() => import('@/routes/referrals'), 'ReferralsPage')
const ProjectTemplatesPage = lazyRouteComponent(() => import('@/routes/project-templates'), 'ProjectTemplatesPage')
const TeamPayoutsPage = lazyRouteComponent(() => import('@/routes/team-payouts'), 'TeamPayoutsPage')
const PayrollPage = lazyRouteComponent(() => import('@/routes/payroll'), 'PayrollPage')
const ReportsPage = lazyRouteComponent(() => import('@/routes/reports'), 'ReportsPage')
const PayslipPage = lazyRouteComponent(() => import('@/routes/payslip'), 'PayslipPage')
const RemindersPage = lazyRouteComponent(() => import('@/routes/reminders'), 'RemindersPage')
const ActivityPage = lazyRouteComponent(() => import('@/routes/activity'), 'ActivityPage')
const InvoiceTemplatesPage = lazyRouteComponent(() => import('@/routes/billing/templates'), 'InvoiceTemplatesPage')
const MyTasksPage = lazyRouteComponent(() => import('@/routes/tasks/my'), 'MyTasksPage')
const MyShootsPage = lazyRouteComponent(() => import('@/routes/shoots/my'), 'MyShootsPage')
const ShootDetailPage = lazyRouteComponent(() => import('@/routes/shoots/$shootId'), 'ShootDetailPage')
const AttendanceUidPage = lazyRouteComponent(() => import('@/routes/attendance/$uid'), 'AttendanceUidPage')
const AllocationMemberPage = lazyRouteComponent(() => import('@/routes/team-allocation/member/$uid'), 'AllocationMemberPage')
const MyWorkProjectPage = lazyRouteComponent(() => import('@/routes/my-work/project/$projectId'), 'MyWorkProjectPage')

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

/** An old-app address: go to the page that does its job now, query string and all. */
function LegacyRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const to = legacyTarget(window.location.pathname, window.location.search) ?? '/'
    void navigate({ href: to, replace: true })
  }, [navigate])
  return null
}

/** Public: no session, no shell. */
const publicRoute = (path: string, component: RouteComponent): AnyRoute =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

/** Signed in: the shell is already around it. */
const route = (path: string, component: RouteComponent): AnyRoute =>
  createRoute({ getParentRoute: () => authedLayout, path, component })

const routeTree = rootRoute.addChildren([
  publicRoute('/', HomePage),
  publicRoute('/login', LoginPage),
  ...LEGACY_PUBLIC_PATHS.map((p) => publicRoute(p, LegacyRedirect)),
  publicRoute('/complete-setup', CompleteSetupPage),
  publicRoute('/verify', VerifyEmailPage),
  publicRoute('/stop-emails', StopEmailsPage),
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
  publicRoute('/enquire/$code', EnquirePage),
  publicRoute('/enquiry-view/$token', EnquiryViewPage),
  // The client portal: one private link per project (0184).
  publicRoute('/p/$token', ClientPortalPage),
  publicRoute('/p/$token/invoice/$invoiceId', ClientPortalInvoicePage),
  publicRoute('/p/$token/terms/$docId', ClientPortalTermsPage),
  // The details form a client fills (0244).
  publicRoute('/details/$token', ClientDetailsPage),
  // The vendor's policy pages (payment-gateway requirement).
  publicRoute('/terms-and-conditions', TermsPage),
  publicRoute('/privacy-policy', PrivacyPage),
  publicRoute('/refund-policy', RefundPage),
  publicRoute('/contact-us', ContactPage),
  publicRoute('/data-deletion', DataDeletionPage),
  // Setup tutorials; the setup emails link here, often opened signed out.
  publicRoute('/help/setup', HelpSetupPage),
  publicRoute('/help/whatsapp', HelpWhatsAppPage),
  // Every tutorial, the questions studios ask, and how to reach us (0236).
  publicRoute('/help', HelpPage),
  // "How to use Studio AutoPilot": every job, in order, with its video and
  // the steps written out, in English or Hindi. Public, for a WhatsApp link.
  publicRoute('/learn', LearnPage),

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
  route('/dashboard', DashboardPage),
  route('/reports', ReportsPage),

  route('/projects', ProjectsListPage),
  route('/projects/new', NewProjectPage),
  route('/projects/$id', ProjectDetailPage),
  route('/projects/$id/client-view', ClientPortalPreviewPage),
  route('/projects/$id/edit', ProjectEditPage),
  route('/projects/$id/quotation', ProjectQuotationPage),
  route('/project-tracking', ProjectTrackingPage),
  route('/project-documents', ProjectDocumentsPage),
  route('/team/work-preview', TeamWorkPreviewPage),
  route('/team/performance', TeamPerformancePage),
  route('/performance/me', MyPerformancePage),
  route('/payouts/my', MyPayoutsPage),
  route('/clients', ClientsListPage),

  // One shoots page: Team Booking. The old list with six open filters is gone.
  route('/shoots', () => <Navigate to="/team-allocation" replace />),
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
  route('/follow-ups/queue', CallQueuePage),
  route('/follow-ups/send', SendNowPage),
  // The funnel, the team and the forecast. Built long ago and unreachable
  // until now -- no route pointed at them while the API kept computing them.
  route('/follow-ups/reports', CrmReportsPage),
  route('/lead-sources', LeadSourcesPage),
  route('/enquiry-forms', EnquiryFormsPage),
  route('/enquiry-forms/$id', EnquiryFormDetailPage),
  // The permissions matrix has declared /facebook as this module's path since
  // Phase 2; keep it working rather than breaking anyone's bookmark.
  route('/facebook', LeadSourcesPage),
  route('/employees', EmployeesPage),
  route('/employees/$id', EmployeeDetailPage),
  route('/attendance', AttendancePage),
  route('/attendance/my', MyAttendancePage),
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
  route('/settings/vendors', VendorsPage),
  route('/settings/client-form', ClientFormPage),
  route('/settings/refer-a-studio', ReferAStudioPage),
  // A page of links to pages that have their own menu lines now.
  route('/settings/advanced', () => <Navigate to="/settings/company" replace />),
  route('/personal-expenses', () => <Navigate to="/company-expenses" replace />),
  // Old-app addresses with no page of their own now (see ./legacy-links).
  ...LEGACY_AUTHED_PATHS.map((p) => route(p, LegacyRedirect)),
  route('/settings/invoicing', InvoiceTemplatesPage),
  route('/settings/appearance', AppearancePage),
  route('/settings/system', SystemPage),
  route('/settings/services', () => <SystemPage focus="services" />),
  route('/settings/work-submissions', () => <SystemPage focus="work-submissions" />),
  route('/referrals', ReferralsPage),
  route('/settings/project-templates', ProjectTemplatesPage),
  route('/team-payouts', TeamPayoutsPage),
  route('/payroll', PayrollPage),
  route('/team/salaries', TeamSalariesPage),
  route('/payroll/payslip/$lineId', PayslipPage),
  route('/reminders', RemindersPage),
  route('/activity', ActivityPage),
  route('/platform/studios', PlatformStudiosPage),
  route('/platform/usage', PlatformUsagePage),
  route('/platform/feedback', PlatformFeedbackPage),
  route('/platform/diamond', PlatformDiamondPage),
  route('/platform/payments', PlatformPaymentsPage),
  route('/platform/plans', PlatformPlansPage),
  route('/platform/messaging', PlatformMessagingPage),
  route('/platform/email', PlatformEmailPage),
  route('/platform/help', PlatformHelpPage),
  route('/platform/studio-referrals', PlatformStudioReferralsPage),
  route('/settings/messaging', MessagingSettingsPage),
  route('/settings/whatsapp', WhatsappSettingsPage),
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
