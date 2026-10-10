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
// WHATSAPP_GRAPH_URL points the API at a stand-in Graph server in local
// end-to-end runs; production never sets it.
/**
 * The one Graph API version for every Meta call. Meta retires a version about
 * two years after release; v21.0 (Oct 2024) was about to go. Move this, the
 * login dialog below and facebook-signup.ts together.
 */
export const GRAPH_VERSION = 'v24.0'
export const GRAPH = (typeof process !== 'undefined' && process.env?.WHATSAPP_GRAPH_URL) || `https://graph.facebook.com/${GRAPH_VERSION}`

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

interface WhatsAppStatusUpdate {
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
        metadata?: { phone_number_id?: string }
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
        messages?: Array<{
          id?: string
          from?: string
          timestamp?: string
          type?: string
          text?: { body?: string }
          button?: { text?: string }
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
          image?: { caption?: string }
          video?: { caption?: string }
          document?: { caption?: string; filename?: string }
        }>
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

interface WhatsAppInbound {
  phoneNumberId: string
  from: string
  name: string | null
  text: string
  id: string | null
  at: string | null
}

const KIND_WORDS: Record<string, string> = {
  image: '[Photo]',
  video: '[Video]',
  audio: '[Voice note]',
  document: '[Document]',
  sticker: '[Sticker]',
  location: '[Location]',
  contacts: '[Contact card]',
}

/**
 * Messages people sent to a WhatsApp number, with the number that received
 * them (metadata.phone_number_id) so each can be routed to its studio. A
 * photo or voice note comes through as words saying what it was.
 */
export function whatsappInboundMessages(body: unknown): WhatsAppInbound[] {
  const b = body as WebhookBody | null
  if (!b || b.object !== 'whatsapp_business_account') return []
  const out: WhatsAppInbound[] = []
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value
      const phoneNumberId = v?.metadata?.phone_number_id
      if (!phoneNumberId) continue
      for (const m of v?.messages ?? []) {
        if (!m.from) continue
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          [KIND_WORDS[m.type ?? ''], m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? m.document?.filename]
            .filter(Boolean)
            .join(' ')
        const name = v?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? v?.contacts?.[0]?.profile?.name ?? null
        out.push({
          phoneNumberId,
          from: m.from,
          name,
          text: text || '[Message]',
          id: m.id ?? null,
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
        })
      }
    }
  }
  return out
}
