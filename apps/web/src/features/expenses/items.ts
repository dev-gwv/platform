import type { ExpenseItemLine } from '@ipc/contracts'

/** One line as it is typed: text boxes, so a half-typed "12." is not lost. */
export interface ItemDraft {
  title: string
  qty: string
  amount: string
}

export const blankItem = (): ItemDraft => ({ title: '', qty: '', amount: '' })

const num = (v: string) => {
  const n = Number(v.replace(/,/g, '').trim())
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** The lines worth saving: a name or an amount, never an empty row. */
export function cleanItems(rows: readonly ItemDraft[]): ExpenseItemLine[] {
  return rows
    .filter((r) => r.title.trim() || num(r.amount) > 0)
    .map((r) => ({
      title: r.title.trim().slice(0, 200),
      amount: Math.round(num(r.amount) * 100) / 100,
      ...(r.qty.trim() ? { qty: num(r.qty) } : {}),
    }))
}

/** What the lines add up to; each line's amount is that line's total. */
export const itemsTotal = (rows: readonly ItemDraft[]): number =>
  Math.round(cleanItems(rows).reduce((s, r) => s + r.amount, 0) * 100) / 100

/**
 * Lines saved on an expense, read leniently: rows imported from the old app
 * may say `name` or `description` where ours say `title`.
 */
export function itemsFrom(saved: ReadonlyArray<Record<string, unknown>> | null | undefined): ItemDraft[] {
  return (saved ?? []).map((r) => {
    const title = [r['title'], r['name'], r['description']].find((v) => typeof v === 'string') as string | undefined
    const amount = Number(r['amount'] ?? r['total'] ?? 0)
    const qty = r['qty'] ?? r['quantity']
    return {
      title: title ?? '',
      amount: Number.isFinite(amount) && amount ? String(amount) : '',
      qty: typeof qty === 'number' || (typeof qty === 'string' && qty) ? String(qty) : '',
    }
  })
}
