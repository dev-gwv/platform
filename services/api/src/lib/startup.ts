/**
 * What the API refuses to start without in production.
 *
 * Without a database every route fails; without JWT_SECRET no session can be
 * signed or checked; without CRON_SECRET the tickers' calls are refused and
 * reminders, the outbox and backstops silently stop. Each of these used to
 * surface as a confusing failure much later, after the deploy had gone green.
 * Outside production nothing is required, so tests and local runs boot bare.
 */
export const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'JWT_SECRET', 'CRON_SECRET'] as const

export function missingRequiredEnv(env: Record<string, string | undefined>): string[] {
  if (env['ENVIRONMENT'] !== 'production') return []
  return REQUIRED_IN_PRODUCTION.filter((key) => !env[key]?.trim())
}
