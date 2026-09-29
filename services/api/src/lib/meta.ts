import { timingSafeEqual, toHex } from './crypto'
import { GRAPH } from './whatsapp'

/**
 * Meta (Facebook/Instagram) lead ads.
 *
 * Meta does not post the lead itself. It posts a notification carrying a
 * `leadgen_id`; the lead's fields are then fetched from the Graph API with
 * the page's access token. Every post is signed with the app secret.
 *
 * Since 0204 each studio connects its own pages: the owner signs in with
 * Facebook (or pastes a long-lived token), we read the pages they manage
 * with each page's own token, and keep those tokens sealed. GRAPH is shared
 * with WhatsApp so one stand-in server covers both in local runs.
 */
export class MetaError extends Error {}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, init)
  const text = await res.text()
  let json: unknown = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  if (!res.ok) {
    const e = (json as { error?: { message?: string; error_user_msg?: string } }).error
    throw new MetaError(e?.error_user_msg || e?.message || `Facebook said no (${res.status})`)
  }
  return json as T
}

/** X-Hub-Signature-256: "sha256=<hex hmac of the raw body>". */
export async function verifyMetaSignature(raw: string, header: string, appSecret: string): Promise<boolean> {
  if (!appSecret || !header) return false
  const given = header.startsWith('sha256=') ? header.slice(7) : header
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  return timingSafeEqual(toHex(mac), given.toLowerCase())
}

interface MetaChange {
  field?: string
  value?: { leadgen_id?: string; form_id?: string; page_id?: string; ad_id?: string; created_time?: number }
}
interface MetaEntry {
  id?: string
  changes?: MetaChange[]
}
export interface MetaLeadgenPayload {
  object: 'page'
  entry: MetaEntry[]
}

/** Whether a webhook body is Meta's leadgen notification shape. */
export function isMetaLeadgenPayload(body: unknown): body is MetaLeadgenPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as { object?: unknown; entry?: unknown }
  return b.object === 'page' && Array.isArray(b.entry)
}

/** Every leadgen id in the notification, with what Meta said about it. */
export function metaLeadgenIds(payload: MetaLeadgenPayload): Array<{ leadgen_id: string; meta: Record<string, unknown> }> {
  const out: Array<{ leadgen_id: string; meta: Record<string, unknown> }> = []
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.leadgen_id
      if (change.field === 'leadgen' && id) {
        out.push({
          leadgen_id: id,
          meta: {
            leadgen_id: id,
            form_id: change.value?.form_id ?? null,
            page_id: change.value?.page_id ?? entry.id ?? null,
            ad_id: change.value?.ad_id ?? null,
            created_time: change.value?.created_time ?? null,
          },
        })
      }
    }
  }
  return out
}

export interface MetaLead {
  name: string | null
  phone: string | null
  email: string | null
  fields: Record<string, string>
}

interface GraphLead {
  id?: string
  created_time?: string
  field_data?: Array<{ name?: string; values?: string[] }>
}

/** Map Graph API field_data to the lead we store. Unknown fields are kept in `fields`. */
export function mapGraphLead(lead: GraphLead): MetaLead {
  // Every answer is kept as sent, custom questions included, under `fields`.
  const fields: Record<string, string> = {}
  for (const f of lead.field_data ?? []) {
    if (f.name && f.values && f.values.length > 0) fields[f.name] = f.values.join(', ')
  }
  // Meta's standard questions are lower-case, but forms built elsewhere are
  // not always: match the keys without case.
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (v.trim()) lower[k.toLowerCase()] = v.trim()
  const pick = (...keys: string[]) => {
    for (const k of keys) if (lower[k]) return lower[k]!
    return null
  }
  const full = pick('full_name', 'name', 'full name')
  const first = pick('first_name', 'first name')
  const last = pick('last_name', 'last name')
  const name = full ?? ([first, last].filter(Boolean).join(' ').trim() || null)
  return {
    name,
    phone: pick('phone_number', 'phone', 'mobile', 'mobile_number', 'phone number', 'contact_number', 'whatsapp_number', 'whatsapp'),
    email: pick('email', 'email_address', 'work_email'),
    fields,
  }
}

/** Fetch one lead's fields with the page's token. Throws on any non-2xx so attempt() logs it. */
export async function fetchMetaLead(pageToken: string, leadgenId: string): Promise<MetaLead> {
  const url = `${GRAPH}/${encodeURIComponent(leadgenId)}?fields=id,created_time,field_data&access_token=${encodeURIComponent(pageToken)}`
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`meta lead fetch failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  return mapGraphLead((await res.json()) as GraphLead)
}

/**
 * "Connect with Facebook": trade the one-time code Facebook sent the browser
 * back with for a long-lived user token. Nothing is stored at this step.
 */
export async function exchangeUserCode(appId: string, appSecret: string, code: string, redirectUri: string): Promise<string> {
  const short = await graph<{ access_token?: string }>(
    `oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
  )
  if (!short.access_token) throw new MetaError('Facebook did not return an access token.')
  const long = await graph<{ access_token?: string }>(
    `oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(short.access_token)}`,
  )
  return long.access_token || short.access_token
}

export interface MetaPage {
  id: string
  name: string
  category: string | null
  access_token: string
}

/** Who the token belongs to, and every page they manage with that page's own token. */
export async function readPages(userToken: string): Promise<{ fb_user_id: string | null; pages: MetaPage[] }> {
  const me = await graph<{ id?: string }>(`me?access_token=${encodeURIComponent(userToken)}`)
  const pages: MetaPage[] = []
  let path: string | null = `me/accounts?fields=id,name,category,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`
  for (let n = 0; path && n < 10; n++) {
    const r: { data?: Array<{ id?: string; name?: string; category?: string; access_token?: string }>; paging?: { cursors?: { after?: string }; next?: string } } =
      await graph(path)
    for (const p of r.data ?? []) {
      if (p.id && p.name && p.access_token) pages.push({ id: p.id, name: p.name, category: p.category ?? null, access_token: p.access_token })
    }
    const after = r.paging?.next ? r.paging.cursors?.after : undefined
    path = after ? `me/accounts?fields=id,name,category,access_token&limit=100&after=${encodeURIComponent(after)}&access_token=${encodeURIComponent(userToken)}` : null
  }
  return { fb_user_id: me.id ?? null, pages }
}

/** Ask Meta to post this page's new leads to the app's webhook. */
export async function subscribePage(pageToken: string, pageId: string): Promise<void> {
  await graph(`${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(pageToken)}`, { method: 'POST' })
}

export async function unsubscribePage(pageToken: string, pageId: string): Promise<void> {
  await graph(`${encodeURIComponent(pageId)}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`, { method: 'DELETE' })
}
