import { GRAPH } from './whatsapp'

/**
 * The Graph calls behind a studio connecting its own WhatsApp number (0203).
 * Every call carries the studio's own token; nothing here uses the
 * platform's number. Errors come back as Meta's own words, which are the
 * useful ones ("Invalid OAuth access token", "Unsupported get request").
 */
export class GraphError extends Error {}

async function graph<T>(token: string | null, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let json: unknown = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  if (!res.ok) {
    const e = (json as { error?: { message?: string; error_user_msg?: string } }).error
    throw new GraphError(e?.error_user_msg || e?.message || `WhatsApp said no (${res.status})`)
  }
  return json as T
}

/** The number behind a phone number id, proving the token can use it. */
export async function readNumber(token: string, phoneNumberId: string): Promise<{ display_phone: string | null; verified_name: string | null }> {
  const r = await graph<{ display_phone_number?: string; verified_name?: string }>(
    token,
    `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
  )
  return { display_phone: r.display_phone_number ?? null, verified_name: r.verified_name ?? null }
}

export interface StudioTemplate {
  name: string
  language: string
  status: string
  category: string | null
  body: string | null
  param_count: number
}

/** The account's message templates, with the body text and how many {{n}} it takes. */
export async function readTemplates(token: string, wabaId: string): Promise<StudioTemplate[]> {
  const out: StudioTemplate[] = []
  let path: string | null = `${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category,components&limit=100`
  for (let page = 0; path && page < 10; page++) {
    const r: {
      data?: Array<{ name?: string; language?: string; status?: string; category?: string; components?: Array<{ type?: string; text?: string }> }>
      paging?: { next?: string; cursors?: { after?: string } }
    } = await graph(token, path)
    for (const t of r.data ?? []) {
      if (!t.name || !t.language) continue
      const body = t.components?.find((c) => c.type === 'BODY')?.text ?? null
      const params = new Set([...(body ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))
      out.push({ name: t.name, language: t.language, status: t.status ?? 'UNKNOWN', category: t.category ?? null, body, param_count: params.size })
    }
    const after = r.paging?.next ? r.paging.cursors?.after : undefined
    path = after
      ? `${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category,components&limit=100&after=${encodeURIComponent(after)}`
      : null
  }
  return out
}

/** Embedded Signup: trade the one-time code for the studio's business token. */
export async function exchangeCode(appId: string, appSecret: string, code: string): Promise<string> {
  const r = await graph<{ access_token?: string }>(
    null,
    `oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`,
  )
  if (!r.access_token) throw new GraphError('Facebook did not return an access token.')
  return r.access_token
}

/** Ask Meta to send this business account's messages to our webhook. */
export async function subscribeApp(token: string, wabaId: string): Promise<void> {
  await graph(token, `${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST' })
}
