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
  /** The first payment in the plan, and what is left after it. */
  advance?: string | undefined
  balance?: string | undefined
}

/**
 * Fill {{client_name}}, {{project_name}}, {{studio_name}}, {{total}},
 * {{event_date}}, {{advance}} and {{balance}}.
 */
export function fillPlaceholders(text: string, ctx: TermsContext): string {
  return text.replace(
    /\{\{\s*(client_name|project_name|studio_name|total|event_date|advance|balance)\s*\}\}/g,
    (_, key: keyof TermsContext) => ctx[key] || '',
  )
}

/** The advance (first payment) and the balance, in rupees, for a plan and a total. */
export function advanceAndBalance(
  plan: ReadonlyArray<{ mode: string; value: number | string }>,
  total: number,
  format: (n: number) => string,
): { advance: string; balance: string } | null {
  const first = plan[0]
  if (!first || !(total > 0)) return null
  const v = Number(first.value) || 0
  const advance = first.mode === 'percent' ? Math.round((total * v) / 100) : v
  return { advance: format(advance), balance: format(Math.max(0, total - advance)) }
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
    key: 'mulberry',
    name: 'Mulberry Weddings',
    hint: 'Our wedding terms · 30 / 30 / 30 / 10',
    preset: '30-30-30-10',
    body: `These terms are between {{studio_name}} and {{client_name}} for {{project_name}} ({{event_date}}). The total agreed amount is {{total}}.

1. Delivery of photographs
Raw photographs will be shared within 7–10 days after settlement of outstanding dues. A selection of best-edited photos may be shared within 5–7 days after the final function.

2. Album delivery
If an album is included in the quotation, the custom album will be delivered within 15 days of design approval and payment completion.

3. Payment schedule
30% retainer fee is required to secure the dates ({{advance}}).
30% is payable on the day of the first event.
30% is payable on the final day of shooting.
Remaining 10% is payable at the time of data delivery.
Payments may be accepted via bank transfer or cash.

4. Album photo selection
The client should select preferred photos for the album within one month of receiving the event photos. A delay in selection may delay album delivery.

5. Wedding film delivery
The first wedding film will be delivered within 35 days after soundtrack approval. The editing timeline starts from the date of song approval.

6. Rights and social media
The studio reserves the right to use selected event photos and films for its portfolio and social media unless agreed otherwise in writing.

7. Photo sharing
Edited photos may be shared via an online gallery, Google Drive, or another suitable delivery method.

8. Data backup
After final delivery, the responsibility of backing up photos and videos rests with the client. The studio is not responsible for lost data after delivery.

9. Cancellation
In case of cancellation due to unforeseen reasons, the advance payment is non-refundable and the quotation may not be revised.

10. Portfolio shoot time
A minimum of 40–45 minutes should be allocated for the bride and groom portfolio shoot.

11. After the vidaai
The team will leave after the vidaai unless post-vidaai home entry coverage is discussed and agreed in advance.

12. Small function shoot duration
For smaller functions like haldi, mehendi and engagement, the shoot duration is generally 5–6 hours unless agreed otherwise.

13. Acknowledgement
By accepting these terms, the client confirms that they have read, understood, and agreed to the terms and conditions.`,
  },
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
