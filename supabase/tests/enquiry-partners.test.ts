import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0274: the main form with WhatsApp after sending, services and guests,
 * partner QR codes (0195's vendor forms moved over), and the same number
 * twice making one lead with a note.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e7000000-0000-4000-8000-000000000001'
const STAFF = 'e7000000-0000-4000-8000-000000000002'
const COMPANY = 'e7000000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const asUser = async <T>(user: string, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}

type Form = { id: string; code: string; slug: string; is_main: boolean }
type Sent = { errors?: Record<string, string>; lead_id?: string; created?: boolean; wa_phone?: string; wa_text?: string; redirect_url?: string }
const send = async (key: string, data: Record<string, unknown>, partner: string | null = null) => {
  const [r] = await q<{ doc: Sent }>(`select enquiry_submit($1, $2, $3::jsonb) as doc`, [key, partner, JSON.stringify(data)])
  return r!.doc
}

let vendorCode = ''
let main: Form

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  const at = files.findIndex((f) => f.startsWith('0274_'))
  for (const f of files.slice(0, at)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'asha@studio.test'), ('${STAFF}', 'ravi@studio.test');
    insert into companies (id, name, owner_user_id, city) values ('${COMPANY}', 'Asha Studio', '${OWNER}', 'Jaipur');
    insert into users (user_id, company_id, role, name, email, phone) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha Rao', 'asha@studio.test', '98769 21126'),
      ('${STAFF}', '${COMPANY}', 'employee', 'Ravi', 'ravi@studio.test', null);
    grant select on crm_webhook_sources, crm_leads to authenticated;
  `)
  // A vendor QR made before 0274, with a lead and a page link.
  vendorCode = await asUser(OWNER, async () => {
    const [f] = await q<{ id: string; code: string }>(`select id, code from create_enquiry_form('Riya Boutique', 'Boutique', '9812345670')`)
    await q(`select enquiry_form_set_page($1, 'oldpagetoken_abcdefghijkl')`, [f!.id])
    return f!.code
  })
  await q(`select * from enquiry_form_submit($1, 'Meera Joshi', '9810000001', null, 'Wedding', null, null, null, null)`, [vendorCode])

  for (const f of files.slice(at)) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  main = (await q<Form>(`select id, code, slug, is_main from enquiry_forms where company_id = $1 and is_main`, [COMPANY]))[0]!
})

describe('vendor forms become partners (0274)', () => {
  it('keeps the code, the page link and the lead credit', async () => {
    const [p] = await q<{ id: string; name: string; label: string; view_token: string }>(
      `select id, name, label, view_token from enquiry_partners where code = $1`,
      [vendorCode],
    )
    expect(p!.name).toBe('Riya Boutique')
    expect(p!.label).toBe('Boutique')
    expect(p!.view_token).toBe('oldpagetoken_abcdefghijkl')
    const [lead] = await q<{ partner_id: string }>(`select partner_id from crm_leads where name = 'Meera Joshi'`)
    expect(lead!.partner_id).toBe(p!.id)
    const [old] = await q<{ archived_at: string | null }>(`select archived_at from enquiry_forms where code = $1`, [vendorCode])
    expect(old!.archived_at).not.toBeNull()
  })

  it('makes one main form with a readable link', async () => {
    expect(main.is_main).toBe(true)
    expect(main.slug).toMatch(/^asha-studio-[0-9a-f]{6}$/)
  })

  it('opens the old printed QR as the main form, sent via the partner, and counts the scan', async () => {
    const [r] = await q<{ doc: { partner: string; studio: string; goes_to: string } }>(`select enquiry_public($1) as doc`, [vendorCode])
    expect(r!.doc.partner).toBe('Riya Boutique')
    expect(r!.doc.studio).toBe('Asha Studio')
    expect(r!.doc.goes_to).toBe('whatsapp')
    const [p] = await q<{ scans: number }>(`select scans from enquiry_partners where code = $1`, [vendorCode])
    expect(p!.scans).toBeGreaterThanOrEqual(1)
  })
})

describe('the main form (0274)', () => {
  it('asks email, event, date and anything else by default', async () => {
    const [f] = await q<{ fields: Record<string, string> }>(`select fields from enquiry_forms where id = $1`, [main.id])
    // This studio had only a vendor form, so its main form is new and takes the spec's questions.
    expect(f!.fields.email).toBe('optional')
    expect(f!.fields.city).toBe('off')
    expect(f!.fields.services).toBe('off')
  })

  it('refuses a link that is not https', async () => {
    await expect(q(`update enquiry_forms set after_submit = 'link', redirect_url = 'http://x.test' where id = $1`, [main.id])).rejects.toThrow()
    await expect(q(`update enquiry_forms set after_submit = 'link', redirect_url = 'javascript:alert(1)' where id = $1`, [main.id])).rejects.toThrow()
    await expect(q(`update enquiry_forms set after_submit = 'link', redirect_url = null where id = $1`, [main.id])).rejects.toThrow()
  })

  it('says what to fix, field by field', async () => {
    await q(`update enquiry_forms set fields = fields || '{"email":"required","services":"optional","city":"optional"}' where id = $1`, [main.id])
    const r = await send(main.slug, { name: 'A', phone: '12345' })
    expect(r.errors).toEqual({ name: 'Enter your name', phone: 'Enter a valid 10-digit mobile number', email: 'Please fill this in' })
  })

  it('makes a lead due now, keeps only the studio\'s services, and writes the WhatsApp message', async () => {
    const r = await send(main.code, {
      name: 'Priya Sharma',
      phone: '+91 98111 22233',
      email: 'priya@test.in',
      event_type: 'Wedding',
      event_date: '2027-02-14',
      city: 'Jaipur',
      services: ['drone', 'Photography', 'Made up thing', 'DRONE'],
      budget: 500000,
      guests: 300,
      message: 'Two days',
    })
    expect(r.errors).toBeUndefined()
    expect(r.created).toBe(true)
    expect(r.wa_phone).toBe('919876921126')
    expect(r.wa_text).toBe(
      'Hi Asha Studio! I just sent you an enquiry.\n\nName: Priya Sharma\nEvent: Wedding, 14 Feb 2027\nCity: Jaipur\nLooking for: Photography, Drone',
    )
    const [lead] = await q<{ phone: string; notes: string; deal_value: string | null; follow_up_at: string; email: string; partner_id: string | null }>(
      `select phone, notes, deal_value, follow_up_at, email, partner_id from crm_leads where id = $1`,
      [r.lead_id],
    )
    expect(lead!.phone).toBe('+919811122233')
    expect(lead!.notes).toBe('Looking for: Photography, Drone\nTwo days')
    expect(lead!.deal_value).toBeNull() // budget is off on this form
    expect(lead!.email).toBe('priya@test.in')
    expect(lead!.partner_id).toBeNull()
    const [n] = await q<{ title: string; body: string }>(`select title, body from notifications where entity_id = $1 and type = 'enquiry_new'`, [r.lead_id])
    expect(n!.title).toBe('New enquiry: Priya Sharma')
    expect(n!.body).toBe('Wedding · 14 Feb 2027 · Jaipur')
  })

  it('makes no second lead for the same number while it is open, and tells whoever has it', async () => {
    const r = await send(main.slug, { name: 'Priya S', phone: '09811122233', email: 'p@test.in', message: 'Also a reception' })
    expect(r.created).toBe(false)
    const [{ n }] = (await q<{ n: number }>(`select count(*)::int as n from crm_leads where right(phone_norm, 10) = '9811122233'`)) as [{ n: number }]
    expect(n).toBe(1)
    const [note] = await q<{ subject: string; body: string }>(`select subject, body from crm_activities where lead_id = $1 and type = 'note'`, [r.lead_id])
    expect(note!.subject).toBe('Enquired again')
    expect(note!.body).toContain('Also a reception')
    const alerts = await q<{ title: string }>(`select title from notifications where type = 'enquiry_again'`)
    expect(alerts[0]!.title).toBe('Enquired again: Priya Sharma')
  })

  it('credits a live partner, not an archived one', async () => {
    const partner = await asUser(OWNER, async () => {
      const [p] = await q<{ id: string; code: string; view_token: string | null }>(
        `select id, code, view_token from create_enquiry_partner('Kiran Florist', 'Decorator, Florist', '9812300000', null, null, 'kirantoken_abcdefghijklmnop')`,
      )
      return p!
    })
    await expect(asUser(OWNER, () => q(`select create_enquiry_partner('kiran florist')`))).rejects.toThrow(/already have a partner/)
    const r = await send(main.slug, { name: 'Neha Gupta', phone: '9822200011', email: 'n@test.in' }, partner.code)
    const [lead] = await q<{ partner_id: string }>(`select partner_id from crm_leads where id = $1`, [r.lead_id])
    expect(lead!.partner_id).toBe(partner.id)

    const page = (await q<{ doc: { leads: { phone: string; email: string | null; status: string }[]; enquiries: number } }>(`select enquiry_partner_page('kirantoken_abcdefghijklmnop') as doc`))[0]!.doc
    expect(page.enquiries).toBe(1)
    // 0276: partners see each lead's real number and email unless the studio hides them.
    expect(page.leads[0]!.phone).toBe('+919822200011')
    expect(page.leads[0]!.email).toBe('n@test.in')
    expect(page.leads[0]!.status).toBe('New')

    await q(`update enquiry_partners set archived_at = now() where id = $1`, [partner.id])
    const r2 = await send(main.slug, { name: 'Tara', phone: '9822200099', email: 't@test.in' }, partner.code)
    const [lead2] = await q<{ partner_id: string | null }>(`select partner_id from crm_leads where id = $1`, [r2.lead_id])
    expect(lead2!.partner_id).toBeNull()
    const [gone] = await q<{ doc: unknown }>(`select enquiry_partner_page('kirantoken_abcdefghijklmnop') as doc`)
    expect(gone!.doc).toBeNull()
  })

  it('credits a partner on a repeat enquiry, and leaves archived leads out of every count (0278)', async () => {
    const partner = await asUser(OWNER, async () => {
      const [p] = await q<{ id: string; code: string }>(
        `select id, code from create_enquiry_partner('Sona Decor', 'Decorator', '9812300011', null, null, 'sonatoken_abcdefghijklmnopq')`,
      )
      return p!
    })
    const page = async () =>
      (await q<{ doc: { enquiries: number; leads: { name: string }[] } }>(`select enquiry_partner_page('sonatoken_abcdefghijklmnopq') as doc`))[0]!.doc
    const stats = async () =>
      (await q<{ enquiries: number }>(`select enquiries from enquiry_partner_stats where partner_id = $1`, [partner.id]))[0]!.enquiries
    const formCount = async () =>
      (await q<{ enquiries: number }>(`select enquiries from enquiry_form_stats where form_id = $1`, [main.id]))[0]!.enquiries
    const before = await formCount()

    // Priya's lead is open and came in without a partner: one lead, now Sona's.
    const again = await send(main.slug, { name: 'Priya S', phone: '9811122233', email: 'p@test.in' }, partner.code)
    expect(again.created).toBe(false)
    const [lead] = await q<{ partner_id: string }>(`select partner_id from crm_leads where id = $1`, [again.lead_id])
    expect(lead!.partner_id).toBe(partner.id)
    expect((await page()).enquiries).toBe(1)
    expect(await stats()).toBe(1)
    // A partner's lead is the partner's, not the main form's.
    expect(await formCount()).toBe(before - 1)

    // A new number through the same QR, then archived: gone from every count.
    const fresh = await send(main.slug, { name: 'Isha', phone: '9822211100', email: 'i@test.in' }, partner.code)
    expect((await page()).enquiries).toBe(2)
    await q(`update crm_leads set is_archived = true where id = $1`, [fresh.lead_id])
    expect((await page()).enquiries).toBe(1)
    expect((await page()).leads.map((l) => l.name)).toEqual(['Priya Sharma'])
    expect(await stats()).toBe(1)

    // A refresh in the same visit is not another scan; the partner still shows.
    const scans = async () => (await q<{ scans: number }>(`select scans from enquiry_partners where id = $1`, [partner.id]))[0]!.scans
    await q(`select enquiry_public($1, $2) as doc`, [main.slug, partner.code])
    const once = await scans()
    const [again2] = await q<{ doc: { partner: string } }>(`select enquiry_public($1, $2, false) as doc`, [main.slug, partner.code])
    expect(again2!.doc.partner).toBe('Sona Decor')
    expect(await scans()).toBe(once)
  })

  it("sends a partner's QR to its own after-send, and the rest to the form's (0281)", async () => {
    const make = async (name: string, token: string) =>
      asUser(OWNER, async () => {
        const [p] = await q<{ id: string; code: string }>(
          `select id, code from create_enquiry_partner($1, null, null, null, null, $2)`,
          [name, token],
        )
        return p!
      })
    const plain = await make('Plain Partner', 'plaintoken_abcdefghijklmnop')
    const linked = await make('Link Partner', 'linktoken_abcdefghijklmnopq')
    const chatty = await make('Chat Partner', 'chattoken_abcdefghijklmnopq')
    const thanks = await make('Thanks Partner', 'thankstoken_abcdefghijklmno')

    // A link needs its link; the studio sets each partner's own.
    await expect(asUser(OWNER, () => q(`update enquiry_partners set after_submit = 'link' where id = $1`, [linked.id]))).rejects.toThrow()
    await asUser(OWNER, async () => {
      await q(`update enquiry_partners set after_submit = 'link', redirect_url = 'https://wa.me/message/LINKPARTNER' where id = $1`, [linked.id])
      await q(`update enquiry_partners set after_submit = 'whatsapp', whatsapp_phone = '+919811100000', whatsapp_text = 'Hi from the jeweller!' where id = $1`, [chatty.id])
      await q(`update enquiry_partners set after_submit = 'thanks', thank_you = 'Thank you, the boutique told us about you.' where id = $1`, [thanks.id])
    })

    // Unset: the main form's WhatsApp, as before.
    const a = await send(main.slug, { name: 'Anu', phone: '9844400001', email: 'a@test.in' }, plain.code)
    expect(a.wa_phone).toBe('919876921126')
    expect(a.redirect_url).toBeNull()

    const b = await send(main.slug, { name: 'Bina', phone: '9844400002', email: 'b@test.in' }, linked.code)
    expect(b.redirect_url).toBe('https://wa.me/message/LINKPARTNER')
    expect(b.wa_phone).toBeNull()
    const [pubB] = await q<{ doc: { goes_to: string } }>(`select enquiry_public($1, $2, false) as doc`, [main.slug, linked.code])
    expect(pubB!.doc.goes_to).toBe('link')

    const c = await send(main.slug, { name: 'Chitra', phone: '9844400003', email: 'c@test.in' }, chatty.code)
    expect(c.wa_phone).toBe('919811100000')
    expect(c.wa_text).toMatch(/^Hi from the jeweller!\n\nName: Chitra/)

    const d = await send(main.slug, { name: 'Dia', phone: '9844400004', email: 'd@test.in' }, thanks.code)
    expect(d.wa_phone).toBeNull()
    expect(d.redirect_url).toBeNull()
    const [pubD] = await q<{ doc: { goes_to: string | null; thank_you: string } }>(`select enquiry_public($1, $2, false) as doc`, [main.slug, thanks.code])
    expect(pubD!.doc.goes_to).toBeNull()
    expect(pubD!.doc.thank_you).toBe('Thank you, the boutique told us about you.')

    // The main form without a partner is untouched.
    const e = await send(main.slug, { name: 'Esha', phone: '9844400005', email: 'e@test.in' })
    expect(e.wa_phone).toBe('919876921126')
  })

  it("asks a partner QR's own questions and keeps the answers and the occasion on the lead (0281)", async () => {
    const wed = await asUser(OWNER, async () => {
      const [p] = await q<{ id: string; code: string }>(
        `select id, code from create_enquiry_partner('Sharma Wedding Desk', null, null, null, null, 'weddingtoken_abcdefghijklmn')`,
      )
      return p!
    })
    const questions = [
      { id: 'side1', label: 'Bride side or groom side?', kind: 'choice', options: ['Bride side', 'Groom side'], required: true },
      { id: 'note1', label: 'Anything you liked at this wedding?', kind: 'text', required: false },
    ]
    // A broken question list is refused by the database.
    await expect(
      asUser(OWNER, () => q(`update enquiry_partners set questions = $1::jsonb where id = $2`, [JSON.stringify([{ id: 'x', label: '', kind: 'nope' }]), wed.id])),
    ).rejects.toThrow()
    await asUser(OWNER, () =>
      q(`update enquiry_partners set occasion = $1, questions = $2::jsonb where id = $3`, ["Priya & Rahul's wedding", JSON.stringify(questions), wed.id]),
    )

    const [pub] = await q<{ doc: { occasion: string; questions: { id: string }[] } }>(`select enquiry_public($1, $2, false) as doc`, [main.slug, wed.code])
    expect(pub!.doc.occasion).toBe("Priya & Rahul's wedding")
    expect(pub!.doc.questions.map((x) => x.id)).toEqual(['side1', 'note1'])

    // A must-answer pick is checked, and an answer not on the list does not count.
    const bad = await send(main.slug, { name: 'Ritu', phone: '9855500001', email: 'r@test.in', answers: { side1: 'Neither' } }, wed.code)
    expect(bad.errors).toEqual({ 'q:side1': 'Pick one' })

    const ok = await send(
      main.slug,
      { name: 'Ritu', phone: '9855500001', email: 'r@test.in', answers: { side1: 'Bride side', note1: '  The candid shots  ', junk: 'x' } },
      wed.code,
    )
    expect(ok.errors).toBeUndefined()
    const [lead] = await q<{ enquiry_occasion: string; enquiry_answers: { question: string; answer: string }[] }>(
      `select enquiry_occasion, enquiry_answers from crm_leads where id = $1`,
      [ok.lead_id],
    )
    expect(lead!.enquiry_occasion).toBe("Priya & Rahul's wedding")
    expect(lead!.enquiry_answers).toEqual([
      { question: 'Bride side or groom side?', answer: 'Bride side' },
      { question: 'Anything you liked at this wedding?', answer: 'The candid shots' },
    ])
    expect(ok.wa_text).toContain("For: Priya & Rahul's wedding\nBride side or groom side?: Bride side")
    const [n] = await q<{ body: string }>(`select body from notifications where entity_id = $1 and type = 'enquiry_new'`, [ok.lead_id])
    expect(n!.body).toContain("Priya & Rahul's wedding")

    // The same number again: one lead, and the note carries the answers.
    const again = await send(main.slug, { name: 'Ritu', phone: '9855500001', email: 'r@test.in', answers: { side1: 'Groom side' } }, wed.code)
    expect(again.lead_id).toBe(ok.lead_id)
    const notes = await q<{ body: string }>(`select body from crm_activities where lead_id = $1 and subject = 'Enquired again'`, [ok.lead_id])
    expect(notes[0]!.body).toContain('Bride side or groom side?: Groom side')

    // The studio changes the questions later: Ritu's lead keeps what she was
    // asked and answered, and only the next enquiry is asked the new ones.
    const edited = [{ id: 'venue1', label: 'Which venue was it?', kind: 'text', required: true }]
    await asUser(OWNER, () => q(`update enquiry_partners set questions = $1::jsonb where id = $2`, [JSON.stringify(edited), wed.id]))
    const [after] = await q<{ doc: { questions: { id: string }[] } }>(`select enquiry_public($1, $2, false) as doc`, [main.slug, wed.code])
    expect(after!.doc.questions.map((x) => x.id)).toEqual(['venue1'])
    const next = await send(main.slug, { name: 'Kavya', phone: '9855500002', email: 'k@test.in', answers: { venue1: 'Leela Palace' } }, wed.code)
    const rows = await q<{ id: string; enquiry_answers: { question: string; answer: string }[] }>(
      `select id, enquiry_answers from crm_leads where id in ($1, $2)`,
      [ok.lead_id, next.lead_id],
    )
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.enquiry_answers]))
    expect(byId[ok.lead_id!]).toEqual([
      { question: 'Bride side or groom side?', answer: 'Bride side' },
      { question: 'Anything you liked at this wedding?', answer: 'The candid shots' },
    ])
    expect(byId[next.lead_id!]).toEqual([{ question: 'Which venue was it?', answer: 'Leela Palace' }])
  })

  it('shows nothing when the form is switched off', async () => {
    await q(`update enquiry_forms set is_active = false where id = $1`, [main.id])
    const [r] = await q<{ doc: unknown }>(`select enquiry_public($1) as doc`, [main.slug])
    expect(r!.doc).toBeNull()
    await expect(send(main.slug, { name: 'Late', phone: '9833300000' })).rejects.toThrow(/not taking/)
    await q(`update enquiry_forms set is_active = true where id = $1`, [main.id])
  })
})
