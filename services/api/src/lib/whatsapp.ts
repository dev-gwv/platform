import type { Env } from '../context'

/**
 * WhatsApp Cloud API (Meta). With a phone number id and access token
 * configured, the API sends the message itself and the lead's history says
 * "sent"; without them the client opens wa.me with the text filled in, which
 * is the same message typed by a person.
 *
 * Text messages (inside a 24-hour customer service window) and approved
 * template messages (the messaging wallet's utility templates, which may be
 * sent at any time).
 */
const GRAPH = 'https://graph.facebook.com/v21.0'

export const whatsappConfigured = (env: Pick<Env, 'WHATSAPP_PHONE_NUMBER_ID' | 'WHATSAPP_ACCESS_TOKEN'>): boolean =>
  !!env.WHATSAPP_PHONE_NUMBER_ID && !!env.WHATSAPP_ACCESS_TOKEN

/** `to` is the normalised number (digits, country code first). Throws on non-2xx. */
export async function sendWhatsAppText(
  env: Pick<Env, 'WHATSAPP_PHONE_NUMBER_ID' | 'WHATSAPP_ACCESS_TOKEN'>,
  to: string,
  body: string,
): Promise<{ message_id: string }> {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`whatsapp send failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { messages?: Array<{ id?: string }> }
  return { message_id: json.messages?.[0]?.id ?? '' }
}

/** The wa.me link that opens the chat with the message filled in. */
export const whatsappLink = (to: string, body: string): string =>
  `https://wa.me/${to}?text=${encodeURIComponent(body)}`

/**
 * Send an approved template. `params` fill the body's {{1}}..{{n}} in order;
 * Meta refuses a blank one, so callers pass templateParams() from
 * @ipc/domain. Throws on non-2xx with Meta's reason.
 */
export async function sendWhatsAppTemplate(
  env: Pick<Env, 'WHATSAPP_PHONE_NUMBER_ID' | 'WHATSAPP_ACCESS_TOKEN'>,
  to: string,
  template: { name: string; language: string },
  params: ReadonlyArray<string>,
): Promise<{ message_id: string }> {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(params.length
          ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] }
          : {}),
      },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    let reason = ''
    try {
      const j = JSON.parse(detail) as { error?: { message?: string; error_data?: { details?: string } } }
      reason = j.error?.error_data?.details ?? j.error?.message ?? ''
    } catch {
      reason = detail
    }
    throw new Error(`WhatsApp refused it (${res.status})${reason ? `: ${reason.slice(0, 200)}` : ''}`)
  }
  const json = (await res.json()) as { messages?: Array<{ id?: string }> }
  return { message_id: json.messages?.[0]?.id ?? '' }
}

export interface WhatsAppStatusUpdate {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  error: string | null
}

interface WebhookBody {
  object?: string
  entry?: Array<{
    changes?: Array<{
      field?: string
      value?: {
        statuses?: Array<{
          id?: string
          status?: string
          errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
        }>
        messages?: Array<{ from?: string; type?: string; text?: { body?: string }; button?: { text?: string } }>
      }
    }>
  }>
}

const STATUSES = new Set(['sent', 'delivered', 'read', 'failed'])

/** Delivery receipts in a WhatsApp Business Account webhook post. */
export function whatsappStatusUpdates(body: unknown): WhatsAppStatusUpdate[] {
  const b = body as WebhookBody | null
  if (!b || b.object !== 'whatsapp_business_account') return []
  const out: WhatsAppStatusUpdate[] = []
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        if (!s.id || !s.status || !STATUSES.has(s.status)) continue
        const e = s.errors?.[0]
        out.push({
          id: s.id,
          status: s.status as WhatsAppStatusUpdate['status'],
          error: e ? (e.error_data?.details ?? e.message ?? e.title ?? `Error ${e.code ?? ''}`.trim()).slice(0, 300) : null,
        })
      }
    }
  }
  return out
}

/**
 * People who replied STOP (opt out) or START (opt back in) to the platform's
 * number. Anything else they write is ignored here.
 */
export function whatsappOptChanges(body: unknown): Array<{ from: string; out: boolean }> {
  const b = body as WebhookBody | null
  if (!b || b.object !== 'whatsapp_business_account') return []
  const out: Array<{ from: string; out: boolean }> = []
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        const text = (m.text?.body ?? m.button?.text ?? '').trim().toUpperCase()
        if (!m.from) continue
        if (text === 'STOP' || text === 'UNSUBSCRIBE') out.push({ from: m.from, out: true })
        else if (text === 'START') out.push({ from: m.from, out: false })
      }
    }
  }
  return out
}
