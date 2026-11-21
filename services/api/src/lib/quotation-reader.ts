import Anthropic from '@anthropic-ai/sdk'
import { quotationReading, type QuotationReading } from '@ipc/contracts'

/**
 * Read a studio's own quotation -- a Canva PDF, a scanned page, a photo of a
 * printout -- into what a project needs (owner, 18 Nov; 0311). Claude reads
 * the document itself (text and pictures), the same engine and call shape the
 * old Diamond screenshot check used (removed 21 Nov), and answers to a
 * JSON schema; we parse it with the contract, so a strange answer is refused
 * rather than half-saved.
 *
 * It reads; it never invents. A blank on the quotation stays null.
 */

export const QUOTE_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
/** Base64 grows a file by a third, and the API takes 32 MB a request. */
export const QUOTE_MAX_BYTES = 20 * 1024 * 1024

const nullable = (t: string) => ({ type: [t, 'null'] })

const SCHEMA = {
  type: 'object',
  properties: {
    client_name: { ...nullable('string'), description: 'The couple or client the quotation is prepared for, as written. Null if not written.' },
    client_phone: { ...nullable('string'), description: "The client's phone if the quotation gives one. Never the studio's own number." },
    client_email: { ...nullable('string'), description: "The client's email if given. Never the studio's own." },
    project_name: { ...nullable('string'), description: 'A short project name, e.g. "Nupur & Rahul Wedding" or "Nupur Jain Wedding". Null if no client name.' },
    events: {
      type: 'array',
      description: 'Every event or function the studio will cover, in date order.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The event as named, e.g. "Haldi", "Mehendi (bride side)", "Wedding".' },
          date: { ...nullable('string'), description: 'YYYY-MM-DD. Null if blank or not given.' },
          start_time: { ...nullable('string'), description: 'HH:MM, 24-hour, only if a start time is written.' },
          hours: { ...nullable('number'), description: 'Coverage hours, e.g. 6 for "6 hrs".' },
          city: { ...nullable('string'), description: 'City or venue as written.' },
          guests: { ...nullable('integer'), description: 'Expected guests if written.' },
          team: {
            type: 'array',
            description: 'The crew for this event, one row per role, e.g. "Traditional Videographer" x1, "Candid Photographer" x1, "Cinematographer" x1, "Drone" x1. Leave out assistants.',
            items: {
              type: 'object',
              properties: { role: { type: 'string' }, quantity: { type: 'integer' } },
              required: ['role', 'quantity'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'date', 'start_time', 'hours', 'city', 'guests', 'team'],
        additionalProperties: false,
      },
    },
    deliverables: {
      type: 'array',
      description: 'What the client receives: each line of the package, then each priced add-on. Titles short and clear.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'e.g. "Highlight film (4-5 min)", "Instagram reels (4-5)", "Royal album, 40 sheets (x2)".' },
          kind: { type: 'string', enum: ['film', 'reel', 'photos', 'album', 'e_invite', 'gallery', 'other'] },
          due_days: {
            ...nullable('integer'),
            description:
              'Days after the last event that the quotation promises it, from its delivery timelines: "2 weeks" = 14, "7 days" = 7, a range like "6-8 weeks" takes the longer end (56). "4 weeks after photo selection" = 28. Null if no timeline covers it.',
          },
          is_add_on: { type: 'boolean', description: 'True only for an extra with its own price, not a package line. Add-ons listed only as names "on request" are left out.' },
          price: { ...nullable('number'), description: 'Rupees, for a priced add-on.' },
        },
        required: ['title', 'kind', 'due_days', 'is_add_on', 'price'],
        additionalProperties: false,
      },
    },
    total: { ...nullable('number'), description: 'The total price in rupees, e.g. 200000 for "₹ 2,00,000". Null if not written.' },
    payment_plan: {
      type: 'array',
      description: 'Payment stages as written, e.g. {label: "To book", percent: 30}.',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, percent: nullable('number') },
        required: ['label', 'percent'],
        additionalProperties: false,
      },
    },
    notes: { ...nullable('string'), description: 'One or two short terms worth keeping, e.g. "Team meals to be arranged by the client". Null if none.' },
  },
  required: ['client_name', 'client_phone', 'client_email', 'project_name', 'events', 'deliverables', 'total', 'payment_plan', 'notes'],
  additionalProperties: false,
} as const

const prompt = (today: string) =>
  `This is a wedding or event photography studio's quotation to a client (India, rupees). Today is ${today}. ` +
  'Read it and report the client, every event with its date, hours, city and team, every deliverable with the delivery time the quotation promises, the total and the payment plan. ' +
  'Copy what is written; never invent a name, a date, a number or a price. A blank or "__" on the page is null. ' +
  'A date written without a year is the next one after today. Rows of a table can wrap across lines: keep each event with its own date. ' +
  "The studio's own name, phone, email and Instagram are not the client's."

/** The part of the SDK we use; a stand-in replaces it in tests. */
export interface MessagesClient {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } }
}

export type QuoteReadResult = { ok: true; reading: QuotationReading } | { ok: false; why: string }

export async function readQuotation(
  apiKey: string | undefined,
  file: { mime: string; bytes: Uint8Array },
  today: string,
  client?: MessagesClient,
): Promise<QuoteReadResult> {
  if (!QUOTE_MIMES.has(file.mime)) return { ok: false, why: 'Upload the quotation as a PDF, or a photo (JPG, PNG or WEBP).' }
  if (!client && !apiKey) return { ok: false, why: 'Reading quotations is not switched on yet. Please ask us to switch it on.' }
  const api = client ?? new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 })
  const data = Buffer.from(file.bytes).toString('base64')
  const source =
    file.mime === 'application/pdf'
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: file.mime as 'image/png' | 'image/jpeg' | 'image/webp', data } } as const)

  try {
    const res = await api.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [source, { type: 'text', text: prompt(today) }] }],
    })
    if (res.stop_reason === 'refusal') return { ok: false, why: 'This file could not be read as a quotation.' }
    const text = res.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return { ok: false, why: 'Nothing could be read from this file.' }
    const parsed = quotationReading.safeParse(cleanReading(JSON.parse(text.text)))
    if (!parsed.success) return { ok: false, why: 'The quotation was read, but not clearly enough to make a project. Try the PDF.' }
    return { ok: true, reading: parsed.data }
  } catch (e) {
    console.error('[quotation] read failed', e instanceof Error ? e.message : e)
    return { ok: false, why: 'The quotation could not be read right now. Please try again in a minute.' }
  }
}

const KINDS = new Set(['film', 'reel', 'photos', 'album', 'e_invite', 'gallery', 'other'])

/** Trims what a model sometimes sends a little out of shape before the contract checks it. */
export function cleanReading(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const time = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null)
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null)
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    client_name: str(r.client_name, 160),
    client_phone: str(r.client_phone, 20),
    client_email: str(r.client_email, 200),
    project_name: str(r.project_name, 160),
    events: arr(r.events)
      .slice(0, 30)
      .map((e: Record<string, unknown>) => ({
        name: str(e?.name, 160) ?? 'Event',
        date: day(e?.date),
        start_time: time(e?.start_time),
        hours: num(e?.hours, 24),
        city: str(e?.city, 200),
        guests: typeof e?.guests === 'number' ? Math.round(num(e.guests, 100000) ?? 0) || null : null,
        team: arr(e?.team)
          .slice(0, 20)
          .map((t: Record<string, unknown>) => ({
            role: str(t?.role, 80),
            quantity: Math.min(40, Math.max(1, Math.round(Number(t?.quantity) || 1))),
          }))
          .filter((t) => t.role),
      })),
    deliverables: arr(r.deliverables)
      .slice(0, 60)
      .map((d: Record<string, unknown>) => ({
        title: str(d?.title, 200),
        kind: KINDS.has(d?.kind as string) ? d?.kind : 'other',
        due_days: typeof d?.due_days === 'number' ? Math.round(num(d.due_days, 730) ?? 0) : null,
        is_add_on: d?.is_add_on === true,
        price: num(d?.price, 1e9),
      }))
      .filter((d) => d.title),
    total: num(r.total, 1e10),
    payment_plan: arr(r.payment_plan)
      .slice(0, 10)
      .map((p: Record<string, unknown>) => ({ label: str(p?.label, 120), percent: num(p?.percent, 100) }))
      .filter((p) => p.label),
    notes: str(r.notes, 1000),
  }
}
