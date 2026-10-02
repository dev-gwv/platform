import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

export const payoutStatus = z.enum(['pending', 'processing', 'completed', 'failed'])
export type PayoutStatus = z.infer<typeof payoutStatus>

export const teamPayout = z.object({
  id: uuid,
  company_id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  amount: money,
  period_start: isoDate,
  period_end: isoDate,
  status: payoutStatus,
  payment_mode: z.string().nullable(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: isoDateTime,
})
export type TeamPayout = z.infer<typeof teamPayout>

export const teamPayoutSummary = z.object({
  total_payouts: z.number().int(),
  total_amount: money,
  pending_amount: money,
  completed_amount: money,
  this_month_amount: money,
})
export type TeamPayoutSummary = z.infer<typeof teamPayoutSummary>

export const teamPayoutList = z.object({
  items: z.array(teamPayout),
  summary: teamPayoutSummary,
})
export type TeamPayoutList = z.infer<typeof teamPayoutList>

export const createTeamPayoutRequest = z.object({
  user_id: uuid,
  amount: money.refine((v) => v > 0, 'amount must be positive'),
  period_start: isoDate,
  period_end: isoDate,
  payment_mode: z.string().trim().max(40).nullish(),
  reference: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(500).nullish(),
}).refine((d) => d.period_end >= d.period_start, { message: 'period_end must be on or after period_start', path: ['period_end'] })
export type CreateTeamPayoutRequest = z.infer<typeof createTeamPayoutRequest>

export const updateTeamPayoutRequest = z.object({
  amount: money.refine((v) => v > 0, 'amount must be positive').optional(),
  period_start: isoDate.optional(),
  period_end: isoDate.optional(),
  payment_mode: z.string().trim().max(40).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})
export type UpdateTeamPayoutRequest = z.infer<typeof updateTeamPayoutRequest>

/**
 * The shoot-derived tracker, kept alongside the manual payouts above rather
 * than replacing them -- a payout tied to an actual booked shoot, settled
 * through a cash ledger instead of typed in from scratch. This never
 * mutates the slot's own cost fields or feeds project profit; it is
 * bookkeeping for what was actually paid, nothing else reads it.
 */
export const payoutEntryType = z.enum(['payment', 'reversal', 'adjustment'])
export type PayoutEntryType = z.infer<typeof payoutEntryType>

export const payoutSettlement = z.object({
  id: uuid,
  slot_id: uuid,
  member_uid: uuid,
  project_id: uuid.nullable(),
  shoot_id: uuid.nullable(),
  /** Snapshotted from the slot's cost when this entry was recorded, not a running total. */
  amount_due: money,
  /** Signed: positive for a payment or adjustment, negative for a reversal. */
  amount_paid: z.number(),
  paid_date: isoDate,
  payment_mode: z.string().nullable(),
  payment_reference: z.string().nullable(),
  notes: z.string().nullable(),
  entry_type: payoutEntryType,
  reverses_settlement_id: uuid.nullable(),
  created_by: uuid.nullable(),
  created_at: isoDateTime,
})
export type PayoutSettlement = z.infer<typeof payoutSettlement>

export const payoutSettlementAggregate = z.object({
  slot_id: uuid,
  /** Running total across every entry for this slot -- reversals already subtracted. */
  paid_total: z.number(),
  last_paid_date: isoDate.nullable(),
  last_reference: z.string().nullable(),
  entries_count: z.number().int(),
})
export type PayoutSettlementAggregate = z.infer<typeof payoutSettlementAggregate>

export const payoutSettlementList = z.object({
  entries: z.array(payoutSettlement),
  aggregates: z.array(payoutSettlementAggregate),
})
export type PayoutSettlementList = z.infer<typeof payoutSettlementList>

export const createPayoutSettlementRequest = z.object({
  slot_id: uuid,
  amount_paid: money.refine((v) => v > 0, 'amount_paid must be positive'),
  paid_date: isoDate.optional(),
  payment_mode: z.string().trim().max(50).nullish(),
  payment_reference: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(500).nullish(),
  entry_type: payoutEntryType.default('payment'),
  reverses_settlement_id: uuid.nullish(),
})
export type CreatePayoutSettlementRequest = z.infer<typeof createPayoutSettlementRequest>

export const createPayoutSettlementResponse = z.object({
  id: uuid,
  paid_total: z.number(),
  amount_due: money,
})
export type CreatePayoutSettlementResponse = z.infer<typeof createPayoutSettlementResponse>

/**
 * One booking's payout on a project's Finance → Payouts tab: who, which
 * shoot, what they are owed, what has gone out, and whether their cards are
 * in (the moment most studios pay a freelancer).
 */
export const projectPayoutRow = z.object({
  slot_id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  engagement_type: z.string().nullable(),
  role: z.string().nullable(),
  shoot_id: uuid,
  shoot_name: z.string().nullable(),
  shoot_date: isoDate.nullable(),
  amount: z.number(),
  cost_status: z.string(),
  paid: z.number(),
  last_paid_date: isoDate.nullable(),
  data_in: z.boolean(),
})
export type ProjectPayoutRow = z.infer<typeof projectPayoutRow>

/** Where one booking's payout stands, to start a "pay now" form from. */
export const slotPayStatus = z.object({
  slot_id: uuid,
  user_name: z.string().nullable(),
  amount: z.number(),
  cost_status: z.string(),
  paid: z.number(),
})
export type SlotPayStatus = z.infer<typeof slotPayStatus>

/**
 * Set what a booking pays and record what was handed over, in one go -- the
 * data dialog's "payout" line. A changed amount becomes the final amount;
 * paid_now 0 records nothing.
 */
export const paySlotRequest = z.object({
  amount: money.optional(),
  paid_now: money.default(0),
  paid_date: isoDate.optional(),
  payment_mode: z.string().trim().max(50).nullish(),
  payment_reference: z.string().trim().max(100).nullish(),
})
export type PaySlotRequest = z.infer<typeof paySlotRequest>

/** A person's own shoot money (My payouts): every booking and every payment. */
export const myPayoutBooking = z.object({
  slot_id: uuid,
  role: z.string().nullable(),
  shoot_name: z.string().nullable(),
  project_name: z.string().nullable(),
  shoot_date: isoDate.nullable(),
  amount: z.number(),
  is_final: z.boolean(),
  paid: z.number(),
})
export const myPayoutPayment = z.object({
  id: uuid,
  slot_id: uuid,
  shoot_name: z.string().nullable(),
  amount: z.number(),
  paid_date: isoDate,
  payment_mode: z.string().nullable(),
  payment_reference: z.string().nullable(),
  entry_type: payoutEntryType,
})
export const myPayouts = z.object({
  bookings: z.array(myPayoutBooking),
  payments: z.array(myPayoutPayment),
  owed: z.number(),
  paid: z.number(),
  /** Of what is owed: for shoots already done (India's date)... */
  owed_now: z.number().default(0),
  /** ...and for shoots still to come. */
  upcoming: z.number().default(0),
  /** Paid before the shoot happened. */
  paid_ahead: z.number().default(0),
  /** UPI or a bank account is on file, so the studio can pay. */
  has_pay_details: z.boolean(),
})
export type MyPayouts = z.infer<typeof myPayouts>
export type MyPayoutBooking = z.infer<typeof myPayoutBooking>

/**
 * Every booking's money for the studio's Team payouts page, each placed on
 * its shoot's day in India. A booking that no longer stands (released,
 * cancelled, or its shoot cancelled) shows only when money went out on it,
 * and is then worth exactly what was paid.
 */
export const crewPayoutRow = z.object({
  slot_id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  role: z.string().nullable(),
  shoot_id: uuid.nullable(),
  shoot_name: z.string().nullable(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  shoot_date: isoDate,
  amount: z.number(),
  cost_status: z.string(),
  paid: z.number(),
  last_paid_date: isoDate.nullable(),
  /** False for a released or cancelled booking kept only for its payments. */
  stands: z.boolean(),
})
export type CrewPayoutRow = z.infer<typeof crewPayoutRow>

export const crewOwedPerson = z.object({
  user_id: uuid,
  user_name: z.string().nullable(),
  owed: z.number(),
  bookings: z.number().int(),
})

export const crewOwed = z.object({
  /** India's today: a shoot before it is owed, one on or after it is upcoming. */
  today: isoDate,
  owed_now: z.number(),
  upcoming: z.number(),
  paid: z.number(),
  paid_ahead: z.number(),
  people: z.array(crewOwedPerson),
})
export type CrewOwed = z.infer<typeof crewOwed>

export const crewPayouts = crewOwed.extend({ rows: z.array(crewPayoutRow) })
export type CrewPayouts = z.infer<typeof crewPayouts>
