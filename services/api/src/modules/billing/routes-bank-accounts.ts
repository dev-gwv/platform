import { Hono } from 'hono'
import { createInvoiceBankAccountRequest, invoiceBankAccount, invoiceBankAccountList } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const bankAccountRoutes = new Hono<AppEnv>()
  // ── Bank accounts (reusable invoice bank/UPI snapshots) ─────
  .get('/bank-accounts', async (c) => {
    const rows = await attempt(c, 'billing.bank_accounts_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, company_id, label, holder, bank, number, ifsc, upi, branch, notes,
               is_default, is_active, created_at
          from invoice_bank_accounts
         where company_id = ${c.get('auth').companyId} and is_active = true
         order by is_default desc, created_at desc`),
    )
    if (!rows) fail(400, 'We could not load bank accounts.')
    return c.json(invoiceBankAccountList.parse({ items: rows }))
  })

  .post('/bank-accounts', requireAction('billing', 'edit'), async (c) => {
    const parsed = createInvoiceBankAccountRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the bank account details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.bank_account_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_bank_accounts set is_default = false where company_id = ${auth.companyId} and is_default = true`
        }
        const norm = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
        const normUpper = (v: unknown): string | null => {
          const n = norm(v)
          return n ? n.toUpperCase() : null
        }
        const holder: string | null = norm(d.holder)
        const bank: string | null = norm(d.bank)
        const number: string | null = norm(d.number)
        const ifsc: string | null = normUpper(d.ifsc)
        const upi: string | null = norm(d.upi)
        const branch: string | null = norm(d.branch)
        const notes: string | null = norm(d.notes)
        return sql`
          insert into invoice_bank_accounts (company_id, label, holder, bank, number, ifsc, upi, branch, notes, is_default)
          values (${auth.companyId}, ${d.label.trim()}, ${holder}, ${bank}, ${number},
                  ${ifsc}, ${upi}, ${branch}, ${notes}, ${d.is_default})
          returning id, company_id, label, holder, bank, number, ifsc, upi, branch, notes, is_default, is_active, created_at`
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not save this bank account.')
    await audit(c, { action: 'invoice_bank_account.create', entityType: 'invoice_bank_account', entityId: rows[0].id, after: { label: d.label } })
    return c.json(invoiceBankAccount.parse(rows[0]), 201)
  })

  .patch('/bank-accounts/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createInvoiceBankAccountRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the bank account details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.bank_account_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_bank_accounts set is_default = false where company_id = ${auth.companyId} and is_default = true and id != ${id}`
        }
        const norm = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
        const normUpper = (v: unknown): string | null => {
          const n = norm(v)
          return n ? n.toUpperCase() : null
        }
        const holder: string | null = norm(d.holder)
        const bank: string | null = norm(d.bank)
        const number: string | null = norm(d.number)
        const ifsc: string | null = normUpper(d.ifsc)
        const upi: string | null = norm(d.upi)
        const branch: string | null = norm(d.branch)
        const notes: string | null = norm(d.notes)
        return sql<{ id: string }[]>`
          update invoice_bank_accounts
             set label = ${d.label.trim()}, holder = ${holder}, bank = ${bank},
                 number = ${number}, ifsc = ${ifsc},
                 upi = ${upi}, branch = ${branch}, notes = ${notes},
                 is_default = ${d.is_default}
           where id = ${id} and company_id = ${auth.companyId} and is_active = true
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this bank account.')
    if (!rows.length) fail(404, 'We could not find that bank account.')
    await audit(c, { action: 'invoice_bank_account.update', entityType: 'invoice_bank_account', entityId: id, after: d })
    return c.json({ ok: true })
  })

  .post('/bank-accounts/:id/default', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.bank_account_default', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const found = await sql<{ id: string }[]>`
          select id from invoice_bank_accounts where id = ${id} and company_id = ${auth.companyId} and is_active = true`
        if (!found.length) return []
        await sql`update invoice_bank_accounts set is_default = false where company_id = ${auth.companyId} and is_default = true`
        return sql<{ id: string }[]>`
          update invoice_bank_accounts set is_default = true
           where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not set the default.')
    if (!rows.length) fail(404, 'We could not find that bank account.')
    await audit(c, { action: 'invoice_bank_account.default', entityType: 'invoice_bank_account', entityId: id })
    return c.json({ ok: true })
  })

  .delete('/bank-accounts/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.bank_account_delete', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
        update invoice_bank_accounts set is_active = false, is_default = false
         where id = ${id} and company_id = ${auth.companyId} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this bank account.')
    if (!rows.length) fail(404, 'We could not find that bank account.')
    await audit(c, { action: 'invoice_bank_account.delete', entityType: 'invoice_bank_account', entityId: id })
    return c.json({ ok: true })
  })
