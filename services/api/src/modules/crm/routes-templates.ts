import { Hono } from 'hono'
import {
  createTemplateRequest,
  updateTemplateRequest,
  crmTemplate,
  sendTemplateRequest,
  sendTemplateResponse,
} from '@ipc/contracts'
import { renderTemplate, crmTemplateVars } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { sendWhatsAppText, whatsappConfigured, whatsappLink } from '../../lib/whatsapp'
import { edit, remove } from './shared'

export const crmTemplateRoutes = new Hono<AppEnv>()
  // ── Templates ───────────────────────────────────────────────
  .get('/templates', async (c) => {
    const includeInactive = c.req.query('include_inactive') === '1'
    const rows = await attempt(c, 'crm.templates', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, name, body, kind, category, usage_count, is_active, created_at
          from crm_templates
          where ${includeInactive ? sql`true` : sql`is_active = true`}
          order by usage_count desc, created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load templates.')
    return c.json(crmTemplate.array().parse(rows))
  })

  .post('/templates', edit, async (c) => {
    const parsed = createTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Check template fields.')
    const { name, body, kind, category } = parsed.data
    const row = await attempt(c, 'crm.template_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql`
          insert into crm_templates (company_id, name, body, kind, category)
          values (get_current_company_id(), ${name}, ${body}, ${kind}, ${category ?? null})
          returning id, name, body, kind, category, usage_count, is_active, created_at`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'Could not create template.')
    const created = crmTemplate.parse(row)
    await audit(c, { action: 'template.create', entityType: 'crm_template', entityId: created.id, after: { name, kind } })
    return c.json(created, 201)
  })

  // A new studio starts with an empty template list and retypes the same
  // WhatsApp message all season. This gives it a starting set; re-running adds
  // only what is missing, so an edited template is never overwritten.
  .post('/templates/seed', edit, async (c) => {
    const n = await attempt(c, 'crm.templates_seed', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ n: number }[]>`
          select seed_crm_message_templates(get_current_company_id()) as n`
        return r?.n ?? 0
      }),
    )
    if (n === null) fail(400, 'We could not add the starter templates.')
    await audit(c, { action: 'template.seed', entityType: 'crm_template', after: { added: n } })
    return c.json({ added: n })
  })

  .patch('/templates/:id', edit, async (c) => {
    const parsed = updateTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Check template fields.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'crm.template_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          update crm_templates set ${sql(parsed.data)} where id = ${id}
          returning id, name, body, kind, category, usage_count, is_active, created_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That template was not found.')
    const updated = crmTemplate.parse(row)
    await audit(c, { action: 'template.update', entityType: 'crm_template', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  // Lovable parity: archive keeps the template (and its usage history) without deleting it.
  .post('/templates/:id/archive', edit, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.template_archive', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`update crm_templates set is_active = false where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not archive this template.')
    if (!rows.length) fail(404, 'That template was not found.')
    await audit(c, { action: 'template.archive', entityType: 'crm_template', entityId: id })
    return c.body(null, 204)
  })

  .delete('/templates/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.template_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from crm_templates where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'Delete failed.')
    if (!rows.length) fail(404, 'That template was not found.')
    await audit(c, { action: 'template.delete', entityType: 'crm_template', entityId: id })
    return c.body(null, 204)
  })

  // Render a template for one lead and hand back the link that opens WhatsApp
  // or the mail client with it filled in. The contact is stamped on the lead's
  // history here, because pressing "send" IS the contact.
  .post('/leads/:id/send-template', edit, async (c) => {
    const parsed = sendTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a template and a channel.')
    const leadId = uuidParam(c)
    const { template_id, channel } = parsed.data

    const result = await attempt(c, 'crm.send_template', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [lead] = await sql<{
          name: string | null; phone: string | null; phone_norm: string | null; email: string | null;
          follow_up_at: string | null; city: string | null; group_name: string | null;
          event_type: string | null; event_date: string | null; deal_value: number | null;
          usage_bump: null;
        }[]>`
          select name, phone, phone_norm, email, follow_up_at, city, group_name,
                 event_type, event_date, deal_value
          from crm_leads where id = ${leadId}`
        if (!lead) return 'no_lead' as const
        const [tpl] = await sql<{ id: string; name: string; body: string }[]>`
          select id, name, body from crm_templates where id = ${template_id}`
        if (!tpl) return 'no_template' as const
        const [studio] = await sql<{ name: string }[]>`select name from companies where id = get_current_company_id()`

        const rendered = renderTemplate(tpl.body, {
          ...crmTemplateVars(
            {
              name: lead.name, phone: lead.phone, email: lead.email,
              follow_up_at: lead.follow_up_at, city: lead.city, group_name: lead.group_name,
              event_type: lead.event_type, event_date: lead.event_date, deal_value: lead.deal_value,
            },
            studio?.name ?? '',
          ),
          // Back-compat: the old call only filled these four.
          studio: studio?.name ?? '',
        })
        if (channel === 'whatsapp' && !lead.phone_norm) return 'no_phone' as const
        if (channel === 'email' && !lead.email) return 'no_email' as const
        return { rendered, templateId: tpl.id, templateName: tpl.name, phoneNorm: lead.phone_norm, email: lead.email }
      }),
    )
    if (result === 'no_lead') fail(404, 'That lead was not found.')
    if (result === 'no_template') fail(404, 'That template was not found.')
    if (result === 'no_phone') fail(422, 'This lead has no phone number to message.')
    if (result === 'no_email') fail(422, 'This lead has no email address.')
    if (!result) fail(400, 'We could not prepare the message.')

    // Deliver: through the Cloud API when the studio has it, else hand back a
    // link that opens the person's own WhatsApp or mail app with the text in.
    let url: string | null
    let delivery: 'api' | 'link' = 'link'
    if (channel === 'whatsapp') {
      if (whatsappConfigured(c.env)) {
        const sent = await attempt(c, 'crm.whatsapp_send', () => sendWhatsAppText(c.env, result.phoneNorm!, result.rendered))
        if (!sent) fail(400, 'WhatsApp did not accept the message. Please try again.')
        url = null
        delivery = 'api'
      } else {
        url = whatsappLink(result.phoneNorm!, result.rendered)
      }
    } else {
      url = `mailto:${result.email}?subject=${encodeURIComponent(result.templateName)}&body=${encodeURIComponent(result.rendered)}`
    }

    // Pressing send IS the contact, whichever way it went out.
    await attempt(c, 'crm.send_template_record', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`
          update crm_leads set last_contacted_at = coalesce(last_contacted_at, now()),
                               contacted_status = 'contacted',
                               quality = coalesce(quality, case when is_hot then 'hot'::text else null end)
          where id = ${leadId}`
        await sql`
          update crm_templates set usage_count = usage_count + 1 where id = ${result.templateId}`
        await sql`
          insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
          values (get_current_company_id(), ${leadId}, null, null, ${c.get('auth').userId},
                  ${`sent "${result.templateName}" via ${channel}${delivery === 'api' ? ' (delivered)' : ''}`})`
        // The message itself is an activity on the timeline.
        await sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, started_at)
          values (get_current_company_id(), ${leadId}, ${channel}, 'out', ${result.templateName}, ${result.rendered},
                  ${delivery === 'api' ? 'whatsapp' : 'manual'}, now())`
      }),
    )
    await audit(c, { action: 'lead.send_template', entityType: 'crm_lead', entityId: leadId, after: { template_id, channel, delivery } })
    return c.json(sendTemplateResponse.parse({ url, rendered: result.rendered, delivery }))
  })
