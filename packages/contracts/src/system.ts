import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

/**
 * Operational surfaces: the audit trail, cron history and the health probe.
 * These are read by the studio owner (audit, cron) or by anyone (health).
 */

export const auditLogEntry = z.object({
  id: uuid,
  actor_user_id: uuid.nullable(),
  actor_name: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  correlation_id: z.string().nullable(),
  created_at: isoDateTime,
})
export type AuditLogEntry = z.infer<typeof auditLogEntry>

export const auditLogPage = z.object({
  items: z.array(auditLogEntry),
  next_cursor: z.string().nullable(),
})
export type AuditLogPage = z.infer<typeof auditLogPage>

export const auditLogQuery = z.object({
  cursor: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  entity_type: z.string().max(60).optional(),
})
export type AuditLogQuery = z.infer<typeof auditLogQuery>

export const cronRun = z.object({
  id: uuid,
  job_name: z.string(),
  started_at: isoDateTime,
  finished_at: isoDateTime.nullable(),
  dry_run: z.boolean(),
  summary: z.record(z.unknown()),
})
export type CronRun = z.infer<typeof cronRun>

/** What POST /cron/reminders answers with. */
export const cronRunResult = z.object({
  ok: z.literal(true),
  summary: z.unknown(),
  crm_follow_ups: z.unknown(),
  work_submission_reminders: z.unknown(),
  deliverable_reminders: z.unknown(),
  purged_refresh_tokens: z.number().int(),
})
export type CronRunResult = z.infer<typeof cronRunResult>

/**
 * The nightly attendance sweep. Separate from the hourly job because it must
 * run once, after the working day: marking people absent at 1am and letting
 * check-in flip them back would make any mid-day absence figure a lie.
 */
export const attendanceSweepResult = z.object({
  ok: z.literal(true),
  marked_absent: z.number().int(),
})
export type AttendanceSweepResult = z.infer<typeof attendanceSweepResult>

export const healthBody = z.object({
  ok: z.boolean(),
  service: z.literal('ipc-api'),
  version: z.string(),
  uptime_s: z.number().int(),
  db: z.enum(['ok', 'unreachable', 'not_configured']),
  db_latency_ms: z.number().nullable(),
})
export type HealthBody = z.infer<typeof healthBody>

/**
 * A crash report from the web app (window.onerror / unhandledrejection).
 * Public and unauthenticated by necessity — a broken session must still be
 * reportable — so the shape is tiny, the rate limit is tight, and nothing in
 * it is trusted beyond the log line.
 */
export const clientErrorReport = z.object({
  kind: z.enum(['error', 'rejection']).default('error'),
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(3000).optional(),
  url: z.string().max(500).optional(),
})
export type ClientErrorReport = z.infer<typeof clientErrorReport>

export const clientErrorAck = z.object({ ok: z.literal(true) })
export type ClientErrorAck = z.infer<typeof clientErrorAck>
