import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { allowedOrigins, isProduction } from './lib/allowed-origins'
import type { AppEnv } from './context'
import { errorHandler, notFoundHandler } from './middleware/errors'
import { requestId } from './middleware/request-id'
import { securityHeaders, rateLimit } from './middleware/security'
import { setLogLevel } from './lib/log'
import { healthRouter } from './modules/health/router'
import { authRouter } from './modules/auth/router'
import { accessRouter } from './modules/access/router'
import { clientsRouter } from './modules/clients/router'
import { projectsRouter } from './modules/projects/router'
import { shootsRouter } from './modules/shoots/router'
import { tasksRouter } from './modules/tasks/router'
import { teamRouter } from './modules/team/router'
import { allocationRouter } from './modules/allocation/router'
import { dataRouter } from './modules/data/router'
import { workRouter, workReminderSettingsRouter } from './modules/work/router'
import { billingRouter } from './modules/billing/router'
import { financialsRouter } from './modules/financials/router'
import { crmRouter } from './modules/crm/router'
import { webhooksRouter, metaRouter } from './modules/webhooks/router'
import { hrRouter } from './modules/hr/router'
import { cronRouter } from './modules/cron/router'
import { notificationsRouter } from './modules/notifications/router'
import { subscriptionRouter } from './modules/subscription/router'
import { termsRouter, publicTermsRouter } from './modules/terms/router'
import { publicQuotesRouter } from './modules/crm/quotes'
import { teamTermsRouter, publicTeamTermsRouter } from './modules/team-terms/router'
import { documentsRouter, publicDocumentsRouter } from './modules/documents/router'
import { filesRouter, publicFilesRouter } from './modules/files/router'
import { enquiriesRouter } from './modules/enquiries/router'
import { partiesRouter } from './modules/parties/router'
import { settingsRouter } from './modules/settings/router'
import { platformRouter } from './modules/platform/router'
import { feedbackRouter } from './modules/feedback/router'
import { referralsRouter, publicReferralsRouter } from './modules/referrals/router'
import { teamPayoutsRouter } from './modules/team-payouts/router'
import { payrollRouter } from './modules/payroll/router'
import { remindersRouter } from './modules/reminders/router'
import { activityRouter } from './modules/activity/router'
import { clientPortalRouter, publicClientPortalRouter } from './modules/client-portal/router'

const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  setLogLevel(c.env.LOG_LEVEL)
  await next()
})
app.use('*', requestId)
app.use('*', securityHeaders)
// Registered below with app.onError, not here: Hono resolves a thrown error
// at the depth it was thrown, so an enclosing try/catch never sees it.
// CORS from an env allowlist. Fail-closed in production.
app.use('*', (c, next) => {
  const allow = allowedOrigins(c.env)
  const isProd = isProduction(c.env)
  if (allow.includes('*') && isProd) {
    console.warn('ALLOWED_ORIGINS contains * in production - denying')
  }
  return cors({
    origin: (origin) => {
      if (allow.length === 0) {
        return isProd ? '' : origin || '*'
      }
      if (allow.includes('*')) {
        return isProd ? '' : origin || '*'
      }
      return allow.includes((origin ?? '').replace(/\/+$/, '')) ? origin : ''
    },
    // `sentry-trace` and `baggage` carry the browser's trace id so a frontend
    // transaction and the API request it caused end up on one timeline. They
    // are NOT optional once the web build sets tracePropagationTargets: the
    // browser attaches them to every matching call, and a preflight that does
    // not allow them fails the request itself — the whole app, not just the
    // tracing.
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'sentry-trace', 'baggage'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Without these the browser cannot read the ids the client shows in its
    // error states, nor the limit headers it could back off on.
    exposeHeaders: ['X-Request-Id', 'X-Correlation-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
    // The refresh cookie (AUTH_COOKIE=1) rides on credentialed requests. The
    // origin above is always echoed from the allowlist, never '*', which is
    // what makes credentials safe to allow.
    credentials: true,
  })(c, next)
})

// ── Rate limits ───────────────────────────────────────────────
// The credential surfaces share ONE tight bucket per address: a password
// guesser gains nothing by alternating login and reset. Session upkeep
// (refresh, session hydrate, sign-out) is routine traffic that every open tab
// generates, so it gets its own, far roomier bucket — sharing the tight one
// meant an office NAT with a dozen people signed in was rate-limited out of
// its own app on a reload.
const CREDENTIAL_PATHS = [
  '/auth/login',
  // Sign-in like the rest, and each call makes an outbound request to Google.
  '/auth/google',
  '/auth/register',
  '/auth/verify',
  '/auth/resend-verification',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/accept-invite',
  '/auth/invite',
]
const credentialLimiter = rateLimit({ windowMs: 60_000, limit: 30, scope: 'ip' })
for (const path of CREDENTIAL_PATHS) app.use(path, credentialLimiter)
app.use('/auth/session', rateLimit({ windowMs: 60_000, limit: 120 }))
app.use('/auth/refresh', rateLimit({ windowMs: 60_000, limit: 120 }))
app.use('/auth/logout', rateLimit({ windowMs: 60_000, limit: 60 }))
app.use('/auth/logout-all', rateLimit({ windowMs: 60_000, limit: 60 }))
app.use('/auth/change-password', rateLimit({ windowMs: 60_000, limit: 10 }))
app.use('/public/*', rateLimit({ windowMs: 60_000, limit: 30 }))
// A client note on a deliverable notifies the studio: a much lower ceiling
// than reading, per address and link (the database also caps a link a day).
app.use('/public/portal/:token/feedback', rateLimit({ windowMs: 60_000, limit: 10 }))
app.use('/webhooks/*', rateLimit({ windowMs: 60_000, limit: 60 }))
app.use('/health', rateLimit({ windowMs: 60_000, limit: 60 }))
// Crash reports are public by necessity; keep the abuse ceiling low and explicit.
app.use('/health/client-errors', rateLimit({ windowMs: 60_000, limit: 20 }))
app.use('/cron/reminders', rateLimit({ windowMs: 60_000, limit: 10 }))

// ── Routers ───────────────────────────────────────────────────
// One router per domain. Domain modules mount their own auth + permission
// middleware; /health stays public.
app.route('/health', healthRouter)
app.route('/auth', authRouter)
app.route('/access', accessRouter)
app.route('/clients', clientsRouter)
app.route('/projects', projectsRouter)
app.route('/shoots', shootsRouter)
app.route('/tasks', tasksRouter)
app.route('/team', teamRouter)
app.route('/allocation', allocationRouter)
app.route('/data', dataRouter)
app.route('/work', workRouter)
app.route('/work/reminder-settings', workReminderSettingsRouter)
app.route('/billing', billingRouter)
app.route('/financials', financialsRouter)
app.route('/crm', crmRouter)
app.route('/webhooks', webhooksRouter)
app.route('/meta', metaRouter)
app.route('/hr', hrRouter)
app.route('/cron', cronRouter)
app.route('/notifications', notificationsRouter)
app.route('/subscription', subscriptionRouter)
app.route('/terms', termsRouter)
app.route('/team-terms', teamTermsRouter)
app.route('/public', publicTermsRouter)
app.route('/documents', documentsRouter)
app.route('/files', filesRouter)
app.route('/enquiries', enquiriesRouter)
app.route('/parties', partiesRouter)
app.route('/public', publicQuotesRouter)
app.route('/public', publicTeamTermsRouter)
app.route('/public', publicDocumentsRouter)
app.route('/public', publicFilesRouter)
app.route('/settings', settingsRouter)
app.route('/platform', platformRouter)
app.route('/feedback', feedbackRouter)
app.route('/referrals', referralsRouter)
app.route('/public', publicReferralsRouter)
app.route('/team-payouts', teamPayoutsRouter)
app.route('/payroll', payrollRouter)
app.route('/reminders', remindersRouter)
app.route('/activity', activityRouter)
app.route('/client-portal', clientPortalRouter)
app.route('/public', publicClientPortalRouter)

// Every failure leaves through here, in one JSON envelope the web client
// can read. Hono's own handler would return the bare message instead.
app.onError(errorHandler)
app.notFound(notFoundHandler)

export default app
