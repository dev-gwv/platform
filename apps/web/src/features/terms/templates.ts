import type { PaymentTermDraft } from './api'

/**
 * Ready-made terms, so the first send takes a minute and not an afternoon.
 *
 * Each one carries the clauses AND a payment plan, because that is how a
 * studio thinks of them ("our usual wedding terms, 30/40/30"). Words in
 * {{double braces}} are filled from the project before anything is shown, so
 * what the owner reads is exactly what the client will read.
 */

export interface TermsContext {
  client_name: string
  project_name: string
  studio_name: string
  total: string
  event_date: string
}

/** Fill {{client_name}}, {{project_name}}, {{studio_name}}, {{total}} and {{event_date}}. */
export function fillPlaceholders(text: string, ctx: TermsContext): string {
  return text.replace(/\{\{\s*(client_name|project_name|studio_name|total|event_date)\s*\}\}/g, (_, key: keyof TermsContext) =>
    ctx[key] || '',
  )
}

export interface PaymentPreset {
  key: string
  label: string
  parts: ReadonlyArray<{ label: string; percent: number; when: string }>
}

/** The payment plans studios actually use, one tap each. */
export const PAYMENT_PRESETS: readonly PaymentPreset[] = [
  {
    key: '30-40-30',
    label: '30 / 40 / 30',
    parts: [
      { label: 'Booking amount', percent: 30, when: 'On signing' },
      { label: 'Before the event', percent: 40, when: 'Before the first shoot' },
      { label: 'Balance', percent: 30, when: 'Before delivery' },
    ],
  },
  {
    key: '30-30-30-10',
    label: '30 / 30 / 30 / 10',
    parts: [
      { label: 'Booking amount', percent: 30, when: 'On signing' },
      { label: 'Before first shoot', percent: 30, when: 'Before the first shoot' },
      { label: 'Before final shoot', percent: 30, when: 'Before the final shoot' },
      { label: 'On delivery', percent: 10, when: 'On delivery' },
    ],
  },
  {
    key: '50-50',
    label: '50 / 50',
    parts: [
      { label: 'Advance', percent: 50, when: 'On signing' },
      { label: 'Balance', percent: 50, when: 'On delivery' },
    ],
  },
  {
    key: '100',
    label: 'Full advance',
    parts: [{ label: 'Full payment', percent: 100, when: 'On signing' }],
  },
]

export const presetTerms = (preset: PaymentPreset): PaymentTermDraft[] =>
  preset.parts.map((p) => ({ label: p.label, mode: 'percent', value: p.percent, due_trigger: p.when }))

export interface BuiltInTemplate {
  key: string
  name: string
  hint: string
  preset: string
  body: string
}

const COMMON_END = `Cancellation: the booking amount is not refundable. If the event is cancelled more than 60 days before the date, other payments made are refunded less the booking amount.

Date change: we will try our best to move to a new date, subject to our team's availability. A date change is not a cancellation.

Copyright: {{studio_name}} keeps the copyright of all photos and videos and may use a small selection for its portfolio and social media, unless {{client_name}} asks in writing not to.

Raw files: unedited (raw) files are not part of the delivery unless listed above.

Data: we keep a backup of your files for 6 months after delivery. Please save your copy safely.

Our liability for any loss is limited to the amount paid to us.`

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    key: 'wedding',
    name: 'Wedding',
    hint: 'Multi-day wedding · 30 / 40 / 30',
    preset: '30-40-30',
    body: `These terms are between {{studio_name}} and {{client_name}} for {{project_name}} ({{event_date}}). The total agreed amount is {{total}}.

Booking: the date is confirmed only after the booking amount is received.

Payments: please pay as per the payment plan above. Delivery starts once all payments are made.

Team and travel: the team listed in the quotation will cover the events. Travel and stay outside the city are paid by the client unless included above.

Extra hours: coverage beyond the agreed hours is charged extra, at the rate told to you before the event.

Delivery: edited photos within 45 days and the wedding film within 90 days of the last event. You get one round of changes on the film; more changes are charged.

${COMMON_END}`,
  },
  {
    key: 'short',
    name: 'Pre-wedding / single shoot',
    hint: 'One shoot · 50 / 50',
    preset: '50-50',
    body: `These terms are between {{studio_name}} and {{client_name}} for {{project_name}} ({{event_date}}). The total agreed amount is {{total}}.

Booking: the date is confirmed only after the advance is received.

Location and permits: entry fees, permits and travel to the location are paid by the client unless included above.

Weather: if the shoot cannot happen because of weather, we will fix a new date at no extra cost.

Delivery: edited photos within 21 days, and the film (if any) within 30 days.

${COMMON_END}`,
  },
  {
    key: 'corporate',
    name: 'Corporate / event',
    hint: 'Business event · full advance',
    preset: '100',
    body: `These terms are between {{studio_name}} and {{client_name}} for {{project_name}} ({{event_date}}). The total agreed amount is {{total}} plus applicable GST.

Scope: coverage is as described in the quotation. Anything extra asked for on the day is charged separately.

Access: the client will arrange entry passes and parking for our team.

Delivery: edited photos within 7 working days; videos within 15 working days.

Usage: the client may use the photos and videos for its own business and marketing.

${COMMON_END}`,
  },
]

export const DEFAULT_LEGAL_NOTE = 'By tapping "I agree" you confirm you have read and accept these terms.'
