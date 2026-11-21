import { computeGst, type GstSlab } from './gst'
import { roundINR, sumINR } from './money'

export interface InvoiceLineInput {
  description: string
  /** The subtext line underneath the description. */
  subtext?: string | undefined
  quantity: number
  rate: number
  gst_rate: GstSlab
  /** What the quantity is counted in -- "sq ft", "hours". Shown beside it; no effect on the sum. */
  unit?: string | null | undefined
  /** How many days the line runs (an LED screen for 3 days). Multiplies the amount; empty = 1. */
  days?: number | null | undefined
}

export interface InvoiceLine extends InvoiceLineInput {
  amount: number // quantity * rate * days
  taxable: number // amount after proportional discount
  cgst: number
  sgst: number
  igst: number
}

export interface InvoiceTotals {
  lines: InvoiceLine[]
  subtotal: number
  discount: number
  taxable: number
  tax: number
  total: number
}

/**
 * Compute an invoice from its lines. Discount is given as a flat ₹ amount or
 * a percentage of the subtotal — either way it resolves to one flat ₹ figure
 * here, which is the only form that ever reaches the API or gets persisted;
 * a percent discount is not remembered as a percent once saved. It is applied
 * proportionally across lines, then GST is charged on each line's discounted
 * taxable value using the place-of-supply split. This is the single source
 * the API persists.
 */
export function computeInvoice(
  lines: ReadonlyArray<InvoiceLineInput>,
  opts: { intraState: boolean; discount?: number; discountType?: 'flat' | 'percent' },
): InvoiceTotals {
  const amounts = lines.map((l) => lineAmount(l))
  const subtotal = sumINR(amounts)
  const rawDiscount = opts.discount ?? 0
  const flatDiscount =
    opts.discountType === 'percent' ? roundINR(subtotal * (Math.max(0, rawDiscount) / 100)) : rawDiscount
  const discount = Math.min(Math.max(0, flatDiscount), subtotal)
  const ratio = subtotal > 0 ? (subtotal - discount) / subtotal : 1

  const taxables = spreadTaxable(amounts, ratio, subtotal - discount)
  const computed: InvoiceLine[] = lines.map((l, i) => {
    const amount = amounts[i] ?? 0
    const taxable = taxables[i] ?? 0
    const g = computeGst(taxable, l.gst_rate, { intraState: opts.intraState })
    return { ...l, amount, taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst }
  })

  const taxable = sumINR(computed.map((l) => l.taxable))
  const tax = sumINR(computed.map((l) => l.cgst + l.sgst + l.igst))
  return { lines: computed, subtotal, discount, taxable, tax, total: roundINR(taxable + tax) }
}

/**
 * Each line's discounted taxable, in paise, so the lines add up to exactly
 * subtotal − discount. Rounding each line on its own drifts (three lines of
 * ₹10,000 less ₹10,000 gave ₹6,666.67 × 3 = ₹20,000.01); the paise left over
 * go to the largest line, the one where a paisa matters least.
 */
function spreadTaxable(amounts: ReadonlyArray<number>, ratio: number, target: number): number[] {
  const paise = amounts.map((a) => Math.round((a * ratio + Number.EPSILON) * 100))
  if (ratio === 1 || paise.length === 0) return paise.map((p) => p / 100)
  const remainder = Math.round((target + Number.EPSILON) * 100) - paise.reduce((x, y) => x + y, 0)
  if (remainder !== 0) {
    let largest = 0
    amounts.forEach((a, i) => {
      if (a > (amounts[largest] ?? 0)) largest = i
    })
    paise[largest] = (paise[largest] ?? 0) + remainder
  }
  return paise.map((p) => p / 100)
}

/** quantity × rate × days (days empty or 0 counts as 1), rounded to the rupee's paise. */
export function lineAmount(l: Pick<InvoiceLineInput, 'quantity' | 'rate' | 'days'>): number {
  const days = l.days && l.days > 0 ? l.days : 1
  return roundINR(l.quantity * l.rate * days)
}

const plainNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))))

/**
 * How a line is counted, in words, for the Qty column of a quote or invoice:
 * "96 sq ft × 3 days", "2 hours", "1". The rate column says "per sq ft per
 * day" with `rateUnit`, so the client can check the sum themselves.
 */
export function lineMeasure(l: { quantity: number; unit?: string | null | undefined; days?: number | null | undefined }): string {
  const unit = l.unit?.trim()
  const qty = unit ? `${plainNumber(l.quantity)} ${unit}` : plainNumber(l.quantity)
  if (!l.days || l.days <= 0) return qty
  return `${qty} × ${plainNumber(l.days)} ${l.days === 1 ? 'day' : 'days'}`
}

/** "per sq ft per day", "per day", "per hour", or "" when the line has neither. */
export function rateUnit(l: { unit?: string | null | undefined; days?: number | null | undefined }): string {
  const parts = []
  const unit = l.unit?.trim()
  if (unit) parts.push(`per ${unit}`)
  if (l.days && l.days > 0) parts.push('per day')
  return parts.join(' ')
}
