import { Hono } from 'hono'
import { supportCallNotice, supportWhatsappOverview, supportWhatsappSettings } from '@ipc/contracts'
import { z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { describeError, log } from '../../lib/log'
import { whatsappConfigured } from '../../lib/whatsapp'
import { maskNumber, sampleNotice, verifySupportCallSignature } from '../../lib/support-calls'
import { botGroups, botLogout, botStatus, drainSupportCalls, queueTest, readSupportSettings, saveSupportCallNotice } from '../../lib/support-call-store'

/** Send what is due now, without holding up the answer to whoever asked. */
function drainSoon(env: AppEnv['Bindings']) {
  void drainSupportCalls(env).catch((err: unknown) => log.error({ err: describeError(err) }, 'support call drain failed'))
}

/**
 * POST /webhooks/support-call: the booking app telling us of a support call
 * booked, moved or cancelled (docs/support-call-webhook.md). Signed with
 * SUPPORT_CALL_WEBHOOK_SECRET; 401 unsigned or stale, 400 malformed, 200 once
 * saved (or already seen), 503 when it could not be saved so the booking app
 * tries again.
 */
export const supportCallWebhookRouter = new Hono<AppEnv>().post('/support-call', async (c) => {
  const raw = await c.req.text()
  if (raw.length > 64_000) return c.json({ error: 'too large' }, 413)
  if (!(await verifySupportCallSignature(raw, c.req.header('x-signature'), c.env.SUPPORT_CALL_WEBHOOK_SECRET))) {
    return c.json({ error: 'bad or missing signature' }, 401)
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return c.json({ error: 'not JSON' }, 400)
  }
  const parsed = supportCallNotice.safeParse(json)
  if (!parsed.success) return c.json({ error: 'bad notice', detail: parsed.error.issues[0]?.message ?? '' }, 400)
  const result = await attempt(c, 'support_call.notice', () => saveSupportCallNotice(c.env, parsed.data))
  if (!result) return c.json({ error: 'try again' }, 503)
  if (result === 'saved') drainSoon(c.env)
  return c.json({ ok: true, duplicate: result === 'duplicate' })
})

const saveRequest = supportWhatsappSettings

/**
 * Platform -> Support calls: platform admins only (requirePlatformAdmin) --
 * studios and their teams never see these switches, numbers or messages.
 */
export const platformSupportCallsRouter = new Hono<AppEnv>()
  .use('/support-calls', requireAuth, requirePlatformAdmin())
  .use('/support-calls/*', requireAuth, requirePlatformAdmin())

  .get('/support-calls', async (c) => {
    const [bot, data] = await Promise.all([
      botStatus(c.env),
      attempt(c, 'platform.support_calls', () =>
        withService(c.env, async (sql) => {
          const settings = await readSupportSettings(sql)
          const bookings = await sql<Record<string, unknown>[]>`
            select id, status, starts_at::text as starts_at, name, studio_name, whatsapp_ok, phone is not null as has_phone
              from support_call_bookings order by starts_at desc limit 20`
          const messages = await sql<Record<string, unknown>[]>`
            select o.id, o.channel, o.audience, o.to_number, o.status, o.last_error, o.send_after::text as send_after,
                   o.sent_at::text as sent_at, o.template, o.dedupe_key, b.name as booking_name
              from support_call_outbox o left join support_call_bookings b on b.id = o.booking_id
             order by o.created_at desc limit 50`
          const sent = await sql<{ hour: number; day: number }[]>`
            select count(*) filter (where sent_at > now() - interval '1 hour')::int as hour,
                   count(*) filter (where sent_at > now() - interval '24 hours')::int as day
              from support_call_outbox where channel = 'group' and status = 'sent'`
          return { settings, bookings, messages, sent: sent[0] ?? { hour: 0, day: 0 } }
        }),
      ),
    ])
    if (!data) fail(400, 'We could not load the support calls.')
    const what = (m: Record<string, unknown>) => {
      const key = String(m.dedupe_key ?? '')
      const who = m.booking_name ? ` · ${String(m.booking_name)}` : ''
      if (key.startsWith('summary:')) return "Today's calls"
      if (key.startsWith('test:')) return 'Test'
      if (m.channel === 'group') return `Group post${who}`
      return `${String(m.template ?? 'Template')}${who}`
    }
    return c.json(
      supportWhatsappOverview.parse({
        settings: data.settings,
        ready: { webhook_secret: !!c.env.SUPPORT_CALL_WEBHOOK_SECRET, official_api: whatsappConfigured(c.env), bot_secret: !!c.env.WA_BOT_SECRET },
        bot: { ...bot, sent_last_hour: data.sent.hour, sent_today: data.sent.day },
        bookings: data.bookings,
        messages: data.messages.map((m) => ({
          id: m.id,
          channel: m.channel,
          audience: m.audience,
          to: m.channel === 'group' ? null : maskNumber((m.to_number as string | null) ?? null),
          what: what(m),
          status: m.status,
          last_error: m.last_error ?? null,
          send_after: m.send_after,
          sent_at: m.sent_at ?? null,
        })),
      }),
    )
  })

  .put('/support-calls/settings', async (c) => {
    const parsed = saveRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    const d = parsed.data
    const numbers = [...new Set(d.team_numbers)]
    const ok = await attempt(c, 'platform.support_calls_save', () =>
      withService(c.env, (sql) => sql`
        update platform_settings set
          support_wa_official_on = ${d.official_on}, support_wa_bot_on = ${d.bot_on},
          support_wa_team_numbers = ${numbers}, support_wa_group_jid = ${d.group_jid}, support_wa_group_name = ${d.group_name},
          support_wa_hourly_cap = ${d.hourly_cap}, support_wa_daily_cap = ${d.daily_cap}, support_wa_daily_summary = ${d.daily_summary},
          support_wa_tpl_booked = ${d.tpl_booked}, support_wa_tpl_reminder = ${d.tpl_reminder},
          support_wa_tpl_cancelled = ${d.tpl_cancelled}, support_wa_tpl_team = ${d.tpl_team}, updated_at = now()`),
    )
    if (!ok) fail(400, 'We could not save the settings.')
    // Numbers are said by count, never written into the audit trail.
    await audit(c, {
      action: 'platform.support_calls_settings',
      entityType: 'platform_settings',
      entityId: null,
      after: { official_on: d.official_on, bot_on: d.bot_on, team_numbers: numbers.length, group: d.group_name, hourly_cap: d.hourly_cap, daily_cap: d.daily_cap, daily_summary: d.daily_summary },
    })
    return c.json({ ok: true })
  })

  .get('/support-calls/groups', async (c) => {
    const groups = await attempt(c, 'platform.support_calls_groups', () => botGroups(c.env))
    if (!groups) fail(400, 'The bot could not list its groups. Is it linked?')
    return c.json(groups)
  })

  .post('/support-calls/bot/logout', async (c) => {
    const ok = await attempt(c, 'platform.support_calls_logout', () => botLogout(c.env).then(() => true))
    if (!ok) fail(400, 'The bot could not be unlinked.')
    await audit(c, { action: 'platform.support_calls_bot_logout', entityType: 'platform_settings', entityId: null })
    return c.json({ ok: true })
  })

  // A made-up booking through the whole path, for trying it before the booking
  // app sends real ones. It never messages anyone personally (sampleNotice).
  .post('/support-calls/sample', async (c) => {
    const result = await attempt(c, 'platform.support_calls_sample', () => saveSupportCallNotice(c.env, sampleNotice()))
    if (!result) fail(400, 'We could not make the sample booking.')
    await audit(c, { action: 'platform.support_calls_sample', entityType: 'platform_settings', entityId: null })
    drainSoon(c.env)
    return c.json({ ok: true })
  })

  .post('/support-calls/test', async (c) => {
    const parsed = z.object({ target: z.enum(['group', 'team']) }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Say which test.')
    let refused: string | null = null
    const key = await attempt(c, 'platform.support_calls_test', () =>
      queueTest(c.env, parsed.data.target).catch((err: unknown) => {
        refused = describeError(err).message
        return null
      }),
    )
    if (refused) fail(422, refused)
    if (!key) fail(400, 'We could not queue the test.')
    drainSoon(c.env)
    return c.json({ ok: true })
  })
