import { Hono } from 'hono'
import {
  createReferralCampaignRequest,
  getOrCreateCampaignRequest,
  publicReferralCampaign,
  referralCampaign,
  updateReferralSubmissionRequest,
  referralCampaignList,
  referralCampaignStatus,
  referralSubmissionList,
  submitReferralRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule, requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Referral system — campaigns and submissions.
 * Admin/manager can manage campaigns; submissions are tracked automatically.
 */
export const referralsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Campaigns ──────────────────────────────────────────────
  .get('/campaigns', requireModule('referrals'), async (c) => {
    const rows = await attempt(c, 'referrals.campaigns', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // The project and client each campaign belongs to, so a project's own
        // campaign can be found -- without them the project's referral card
        // always fell back to the first campaign in the studio.
        const campaigns = await sql`
          select rc.id, rc.company_id, rc.name, rc.slug, rc.description, rc.reward_type, rc.reward_value,
                 rc.reward_description, rc.reward_title, rc.project_id, p.name as project_name,
                 rc.client_id, cl.name as client_name, rc.status, rc.created_at
            from referral_campaigns rc
            left join projects p on p.id = rc.project_id
            left join clients cl on cl.id = rc.client_id
           where rc.company_id = ${c.get('auth').companyId}
           order by rc.created_at desc`
        const summary = await sql`
          select count(*)::int as total_campaigns,
                 count(*) filter (where status = 'active')::int as active_campaigns,
                 (select count(*)::int from referral_submissions where company_id = ${c.get('auth').companyId}) as total_submissions,
                 (select count(*)::int from referral_submissions where company_id = ${c.get('auth').companyId} and status = 'converted') as converted_submissions,
                 (select coalesce(sum(reward_amount), 0) from referral_submissions where company_id = ${c.get('auth').companyId} and reward_granted = true) as total_rewards
            from referral_campaigns
           where company_id = ${c.get('auth').companyId}`
        return { campaigns, summary: summary[0] }
      }),
    )
    if (!rows) fail(400, 'We could not load referrals.')
    return c.json(referralCampaignList.parse(rows))
  })

  .post('/campaigns', requireAction('referrals', 'edit'), async (c) => {
    const parsed = createReferralCampaignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the campaign details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'referrals.campaign_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const made = await sql<{ id: string; slug: string }[]>`
          insert into referral_campaigns (company_id, name, description, reward_type, reward_value, reward_description, created_by, slug)
          values (${auth.companyId}, ${d.name}, ${d.description ?? null}, ${d.reward_type}, ${d.reward_value}, ${d.reward_description ?? null}, ${auth.userId}, generate_referral_slug(${d.name}))
          returning id, slug`
        return made
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this campaign.')
    await audit(c, { action: 'referral_campaign.create', entityType: 'referral_campaign', entityId: rows[0].id, after: d })
    return c.json({ id: rows[0].id, slug: rows[0].slug }, 201)
  })

  /**
   * The project's own campaign, made the first time it is asked for (one per
   * project, 0102's unique index) -- the old app's Referrals tab worked this
   * way: open it, and the project already has a link to share.
   */
  .post('/campaigns/for-project', requireAction('referrals', 'edit'), async (c) => {
    const parsed = getOrCreateCampaignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A project is required.')
    const auth = c.get('auth')
    const pid = parsed.data.project_id
    const row = await attempt(c, 'referrals.campaign_for_project', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [project] = await sql<{ name: string; client_id: string | null }[]>`
          select name, client_id from projects where id = ${pid} and company_id = ${auth.companyId}`
        if (!project) return null
        const name = `${project.name} referrals`.slice(0, 160)
        await sql`
          insert into referral_campaigns
            (company_id, name, reward_type, reward_value, project_id, client_id, created_by, slug)
          values (${auth.companyId}, ${name}, 'custom', 0, ${pid}, ${project.client_id}, ${auth.userId}, generate_referral_slug(${name}))
          on conflict (company_id, project_id) where project_id is not null do nothing`
        const [made] = await sql`
          select rc.id, rc.company_id, rc.name, rc.slug, rc.description, rc.reward_type, rc.reward_value,
                 rc.reward_description, rc.reward_title, rc.project_id, p.name as project_name,
                 rc.client_id, cl.name as client_name, rc.status, rc.created_at
            from referral_campaigns rc
            left join projects p on p.id = rc.project_id
            left join clients cl on cl.id = rc.client_id
           where rc.company_id = ${auth.companyId} and rc.project_id = ${pid}`
        return made ?? null
      }),
    )
    if (!row) fail(404, 'That project was not found.')
    return c.json(referralCampaign.parse(row))
  })

  .patch('/:id', requireAction('referrals', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createReferralCampaignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the campaign details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'referrals.campaign_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update referral_campaigns
             set name = ${d.name}, description = ${d.description ?? null},
                 reward_type = ${d.reward_type}, reward_value = ${d.reward_value},
                 reward_description = ${d.reward_description ?? null},
                 -- Left alone when not sent: the Referrals page's form has no title field.
                 reward_title = ${d.reward_title === undefined ? sql`reward_title` : d.reward_title}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this campaign.')
    if (!rows.length) fail(404, 'We could not find that campaign.')
    await audit(c, { action: 'referral_campaign.update', entityType: 'referral_campaign', entityId: id, after: d })
    return c.json(okResponse.parse({ ok: true }))
  })

  // A paused/ended campaign fails closed on both public routes above
  // (get_public_referral_campaign and submit_referral each check
  // status = 'active') -- stopping a live link is a status flip, not a
  // delete, which would otherwise erase the campaign's own submission
  // history along with it.
  .patch('/:id/status', requireAction('referrals', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = referralCampaignStatus.safeParse((await c.req.json().catch(() => ({})) as { status?: unknown }).status)
    if (!parsed.success) fail(422, 'Invalid status.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'referrals.campaign_status', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update referral_campaigns set status = ${parsed.data}
          where id = ${id} and company_id = ${auth.companyId}
          returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this campaign.')
    if (!rows.length) fail(404, 'We could not find that campaign.')
    await audit(c, { action: 'referral_campaign.status', entityType: 'referral_campaign', entityId: id, after: { status: parsed.data } })
    return c.json(okResponse.parse({ ok: true }))
  })

  .delete('/:id', requireAction('referrals', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'referrals.campaign_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from referral_campaigns where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this campaign.')
    if (!rows.length) fail(404, 'We could not find that campaign.')
    await audit(c, { action: 'referral_campaign.delete', entityType: 'referral_campaign', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })

  // ── Submissions ────────────────────────────────────────────
  .get('/submissions', requireModule('referrals'), async (c) => {
    const rawCampaignId = c.req.query('campaign_id')
    if (rawCampaignId != null && rawCampaignId !== '') {
      const uc = z.string().uuid().safeParse(rawCampaignId)
      if (!uc.success) fail(422, 'Invalid campaign ID.')
    }
    const campaignId: string | null = rawCampaignId || null
    const rawCursor = c.req.query('cursor') || null
    const cursor: string | null = rawCursor
    if (cursor && Number.isNaN(Date.parse(cursor))) fail(422, 'Invalid cursor.')
    const limitRaw = Number(c.req.query('limit') ?? 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100

    const rows = await attempt(c, 'referrals.submissions', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        return sql`
          select rs.id, rs.campaign_id, rc.name as campaign_name,
                 rs.referrer_name, rs.referrer_phone,
                 rs.client_name, rs.client_phone, rs.client_email,
                 rs.status, rs.reward_granted, rs.reward_amount, rs.notes,
                 rs.event_type, rs.event_date, rs.functions_count,
                 rs.reward_status, rs.referring_client_name, rs.referred_name, rs.referred_phone,
                 rs.referred_email, rs.project_id, rs.source, rs.crm_lead_id,
                 rs.created_at
            from referral_submissions rs
            join referral_campaigns rc on rc.id = rs.campaign_id
           where rs.company_id = ${c.get('auth').companyId}
             and (${campaignId}::uuid is null or rs.campaign_id = ${campaignId}::uuid)
             and (${cursor}::timestamptz is null or rs.created_at < ${cursor}::timestamptz)
           order by rs.created_at desc
           limit ${limit + 1}`
      }),
    )
    if (!rows) fail(400, 'We could not load submissions.')
    const items = rows.slice(0, limit)
    const last = items[items.length - 1] as { created_at?: string } | undefined
    return c.json(
      referralSubmissionList.parse({
        items,
        next_cursor: items.length < rows.length && last?.created_at ? last.created_at : null,
      }),
    )
  })

  .patch('/submissions/:id/status', requireAction('referrals', 'edit'), async (c) => {
    const id = uuidParam(c)
    // Where the referred couple has got to, and -- separately -- whether the
    // client who referred them has had their reward. Either or both.
    const parsed = updateReferralSubmissionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || (!parsed.data.status && !parsed.data.reward_status)) fail(422, 'Invalid status.')
    const { status = null, reward_status: rewardStatus = null } = parsed.data
    const auth = c.get('auth')
    const rows = await attempt(c, 'referrals.submission_status', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update referral_submissions
             set status = coalesce(${status}, status),
                 reward_status = coalesce(${rewardStatus}, reward_status),
                 reward_granted = coalesce(${rewardStatus}, reward_status) = 'given'
                                  or coalesce(${status}, status) = 'rewarded'
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this submission.')
    if (!rows.length) fail(404, 'We could not find that submission.')
    await audit(c, { action: 'referral_submission.status', entityType: 'referral_submission', entityId: id, after: parsed.data })
    return c.json(okResponse.parse({ ok: true }))
  })

// ── Public route (no auth) ─────────────────────────────────
const publicReferralsRouter = new Hono<AppEnv>()

publicReferralsRouter.get('/referrals/campaign/:slug', async (c) => {
  const slug = c.req.param('slug')
  const row = await attempt(c, 'referrals.public_campaign', () =>
    withService(c.env, async (sql) => {
      const rows = await sql<{ get_public_referral_campaign: unknown }[]>`
        select get_public_referral_campaign(${slug}) as get_public_referral_campaign`
      return rows[0]?.get_public_referral_campaign ?? null
    }),
  )
  if (!row) fail(404, 'This referral link is no longer active.')
  // Lovable parity: enrich with company logo + referring-client + reward title.
  // The RPC shape is the base; extras are best-effort so a missing column
  // never breaks the public page.
  let extra: Record<string, unknown> = {}
  try {
    const r = await withService(c.env, async (sql) => {
      const base = row as { campaign_id?: string }
      if (!base?.campaign_id) return null
      const rows = await sql<Record<string, unknown>[]>`select rc.name as campaign_name,
          (select co.logo_url from companies co
            join referral_campaigns rc2 on rc2.company_id = co.id
           where rc2.id = ${base.campaign_id}::uuid limit 1) as logo_url,
          (select rs.referrer_name from referral_submissions rs
            where rs.campaign_id = ${base.campaign_id}::uuid and rs.referrer_name is not null
            order by rs.created_at desc limit 1) as referring_client_name
        from referral_campaigns rc where rc.id = ${base.campaign_id}::uuid`
      return rows[0] ?? null
    })
    if (r) {
      extra = {
        logo_url: (r['logo_url'] as string | null) ?? null,
        referring_client_name: (r['referring_client_name'] as string | null) ?? null,
      }
    }
  } catch {
    extra = {}
  }
  const base = row as Record<string, unknown>
  const rewardTitle =
    typeof base['reward_description'] === 'string' && (base['reward_description'] as string).trim()
      ? ((base['reward_description'] as string).split('\n')[0] ?? '').slice(0, 120)
      : null
  return c.json(publicReferralCampaign.parse({ ...base, ...extra, reward_title: rewardTitle }))
})

publicReferralsRouter.post('/referrals/submit', async (c) => {
  const parsed = submitReferralRequest.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) fail(422, 'Please check the referral details.')
  // Lovable parity: phone with ≥7 digits is required (a studio cannot call back
  // a 3-digit number). Email stays optional.
  const phoneDigits = (parsed.data.client_phone ?? '').replace(/[^\d]/g, '')
  if (phoneDigits.length < 7) fail(422, 'Please enter a valid phone number (at least 7 digits).')
  const campaignId = c.req.query('campaign_id')
  if (!campaignId) fail(422, 'Campaign ID is required.')
  const uc = z.string().uuid().safeParse(campaignId)
  if (!uc.success) fail(422, 'Invalid campaign ID.')
  const d = parsed.data

  let rows: { submit_referral: string }[] | null = null
  try {
    rows = await withService(c.env, async (sql) => {
      const result = await sql<{ submit_referral: string }[]>`
        select submit_referral(
          p_campaign_id => ${campaignId}::uuid,
          p_referrer_name => ${d.referrer_name ?? null},
          p_referrer_phone => ${d.referrer_phone ?? null},
          p_client_name => ${d.client_name},
          p_client_phone => ${d.client_phone ?? null},
          p_client_email => ${d.client_email ?? null},
          p_notes => ${d.notes ?? null},
          p_event_type => ${d.event_type ?? null},
          p_event_date => ${d.event_date ?? null},
          p_functions_count => ${d.functions_count ?? null}
        ) as submit_referral`
      return result
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('campaign not found') || msg.includes('not found')) fail(404, 'Campaign not found.')
    // Lovable parity: 409 duplicate keeps the form open (client shows a
    // "share another friend" notice instead of closing). Match on the RPC's
    // duplicate exception explicitly.
    if (msg.includes('duplicate') || msg.includes('already exists') || msg.includes('23505')) {
      return c.json({ duplicate: true, message: 'This contact has already been referred to the studio. Please share details of another friend or family member.' }, 409)
    }
    throw e
  }

  if (!rows?.[0]) fail(400, 'We could not submit this referral.')
  const submissionId = rows[0].submit_referral
  // Lovable parity (best-effort, never blocks the 201): auto-create a crm_lead
  // + notify studio admins. Failures are swallowed — the referral itself won.
  try {
    await withService(c.env, async (sql) => {
      const camp = await sql<{ company_id: string }[]>`
        select company_id from referral_campaigns where id = ${campaignId}::uuid`
      const companyId = camp[0]?.company_id
      if (!companyId) return
      await sql`insert into crm_leads (company_id, name, phone, email, source, notes)
        values (${companyId}, ${d.client_name}, ${d.client_phone ?? null},
                ${d.client_email ?? null}, 'referral',
                ${[`Event: ${d.event_type ?? '—'}`, `Date: ${d.event_date ?? '—'}`,
                   d.notes ?? null].filter(Boolean).join(' · ')})`
      await sql`insert into notifications (company_id, kind, title, body)
        values (${companyId}, 'referral', 'New referral received',
                ${`${d.client_name} was referred${d.event_type ? ` (${d.event_type})` : ''}.`})`
    })
  } catch {
    // best-effort only
  }
  return c.json({ id: submissionId }, 201)
})

export { publicReferralsRouter }
