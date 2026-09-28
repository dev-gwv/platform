import type { Env } from '../context'
import { withService } from './db'
import { whatsappInboundMessages, whatsappStatusUpdates } from './whatsapp'

/**
 * What Meta posts about studios' own numbers (0203): a client's message goes
 * to the lead with that number in the studio that owns the receiving number
 * (or becomes a new lead), and a receipt lands on the message a sequence
 * sent. A post about a number nobody connected changes nothing.
 *
 * `onlyPhoneNumberId` limits a studio's own webhook to its own number, so a
 * post to one studio's address can never write into another's.
 */
export async function routeStudioWhatsapp(
  env: Env,
  body: unknown,
  onlyPhoneNumberId?: string,
): Promise<{ messages: number; matched: number; receipts: number }> {
  const messages = whatsappInboundMessages(body).filter((m) => !onlyPhoneNumberId || m.phoneNumberId === onlyPhoneNumberId)
  // A receipt is matched by the message id we got back from sending, which
  // is unique to the studio that sent it.
  const receipts = whatsappStatusUpdates(body)
  if (!messages.length && !receipts.length) return { messages: 0, matched: 0, receipts: 0 }
  return withService(env, async (sql) => {
    let matched = 0
    let marked = 0
    for (const m of messages) {
      const [r] = await sql<{ r: { matched?: boolean } }[]>`
        select crm_whatsapp_inbound(${m.phoneNumberId}, ${m.from}, ${m.name}, ${m.text}, ${m.id}, ${m.at}) as r`
      if (r?.r?.matched) matched += 1
    }
    for (const u of receipts) {
      const [r] = await sql<{ ok: boolean }[]>`select crm_whatsapp_receipt(${u.id}, ${u.status}, ${u.error}) as ok`
      if (r?.ok) marked += 1
    }
    return { messages: messages.length, matched, receipts: marked }
  })
}
