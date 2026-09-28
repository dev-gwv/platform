import { z } from 'zod'
import { uuid, isoDate } from './shared/primitives'

/**
 * A member's scorecard for a period (0208): four parts, each from records the
 * app keeps, and a score out of 100 from fixed weights (40/20/20/20). A part
 * with nothing to measure is null and left out of the score.
 */
const pct = z.number().int().nullable()

export const memberScorecard = z.object({
  from: isoDate,
  to: isoDate,
  score: z.number().int().nullable(),
  work: z.object({
    deliverables: z.number().int(),
    tasks: z.number().int(),
    with_due: z.number().int(),
    on_time: z.number().int(),
    avg_days_late: z.coerce.number().nullable(),
    pct,
  }),
  quality: z.object({ approved: z.number().int(), sent_back: z.number().int(), pct }),
  shoots: z.object({
    shoots: z.number().int(),
    measured: z.number().int(),
    on_time: z.number().int(),
    declined: z.number().int(),
    pct,
  }),
  attendance: z
    .object({ present: z.number().int(), late: z.number().int(), absent: z.number().int(), pct })
    .nullable(),
  late_now: z.array(z.object({ title: z.string(), project: z.string().nullable(), days_late: z.number().int() })),
})
export type MemberScorecard = z.infer<typeof memberScorecard>

export const scorecardTeamRow = z.object({
  user_id: uuid,
  name: z.string(),
  engagement_type: z.string(),
  card: memberScorecard,
})
export type ScorecardTeamRow = z.infer<typeof scorecardTeamRow>

/** GET /performance/members/:id and /performance/me: this month and the five before it. */
export const memberScorecardHistory = z.object({
  user_id: uuid,
  name: z.string(),
  months: z.array(memberScorecard),
})
export type MemberScorecardHistory = z.infer<typeof memberScorecardHistory>
