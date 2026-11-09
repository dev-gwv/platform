import { Hono, type Context } from 'hono'
import {
  leadMessagedRequest,
  leadReplyReply,
  leadReplyRequest,
  leadSendDirectRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { writeWithAi } from '../../lib/ai-write'
import { cleanLeadReply, leadReplyMessages } from '../../lib/lead-writer'
import { loadReplyData, recordReply, sendFromStudioNumber, type ReplyData } from '../../lib/lead-reply'
import { edit } from './shared'

/**
 * "Reply with AI" on a lead (owner, 9 Nov). Writing reads the lead through
 * the caller's own rights; sending is pressed by a person, always.
 */

/** Write a reply for one lead. Shared by the CRM and a team member's My leads. */
export async function writeLeadReply(c: Context<AppEnv>, data: ReplyData) {
  const parsed = leadReplyRequest.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) fail(422, 'Pick what the reply is for.')
  const text = cleanLeadReply(
    await writeWithAi(c, {
      kind: `lead_reply:${parsed.data.intent}`,
      messages: leadReplyMessages(parsed.data, data.lead, data.studio, data.acts),
      maxTokens: 500,
      temperature: 0.7,
      cost: 1200,
    }),
  )
  if (!text) fail(503, 'The AI came back empty. Try again.')
  return c.json(leadReplyReply.parse({ text, can_send_direct: data.canDirect }))
}

export const crmAiRoutes = new Hono<AppEnv>()
  .post('/leads/:id/reply', requireAction('crm', 'view'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const data = await attempt(c, 'crm.reply_read', () =>
      withUser(c.env, auth.userId, (sql) => loadReplyData(sql, auth.companyId, id, { dateStatus: true })),
    )
    if (data === null) fail(404, 'That lead was not found.')
    if (!data) fail(400, 'We could not read this lead.')
    return writeLeadReply(c, data)
  })

  // The reply went out from the person's own WhatsApp (or was copied): on the timeline.
  .post('/leads/:id/reply/sent', edit, async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const parsed = leadMessagedRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'There is no message to keep.')
    const ok = await attempt(c, 'crm.reply_sent', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [l] = await sql`select 1 from crm_leads where id = ${id}`
        if (!l) return false
        await recordReply(sql, auth.companyId, id, auth.userId, parsed.data.text, 'manual')
        return true
      }),
    )
    if (ok === false) fail(404, 'That lead was not found.')
    if (ok === null) fail(400, 'We could not keep the message on the lead.')
    await audit(c, { action: 'lead.ai_reply', entityType: 'crm_lead', entityId: id, after: { via: parsed.data.via } })
    return c.json({ ok: true })
  })

  // Send it from the studio's own WhatsApp number, while WhatsApp allows it.
  .post('/leads/:id/reply/send', edit, async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const parsed = leadSendDirectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'There is no message to send.')
    // The lead must be one the caller can see.
    const seen = await attempt(c, 'crm.reply_send_see', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [l] = await sql<{ phone_norm: string | null }[]>`select phone_norm from crm_leads where id = ${id}`
        return l ?? false
      }),
    )
    if (seen === false) fail(404, 'That lead was not found.')
    if (!seen) fail(400, 'We could not read this lead.')
    if (!seen.phone_norm) fail(422, 'This lead has no phone number to message.')
    const out = await attempt(c, 'crm.reply_send', () =>
      withService(c.env, async (sql) => {
        const r = await sendFromStudioNumber(c.env, sql, auth.companyId, id, seen.phone_norm!, parsed.data.text)
        if (r === 'sent') await recordReply(sql, auth.companyId, id, auth.userId, parsed.data.text, 'whatsapp')
        return r
      }),
    )
    if (out === 'closed')
      fail(409, 'WhatsApp only lets your number write first within 24 hours of their last message. Use Open WhatsApp instead.')
    if (out === 'not_connected') fail(409, 'Your WhatsApp number is not connected. Use Open WhatsApp instead.')
    if (!out) fail(400, 'WhatsApp did not take the message. Use Open WhatsApp instead.')
    await audit(c, { action: 'lead.ai_reply', entityType: 'crm_lead', entityId: id, after: { via: 'studio_number' } })
    return c.json({ ok: true })
  })
