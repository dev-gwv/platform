-- 0316: indexes for the Leads pages (/crm/leads/page, /columns, /counts) and
-- an expired referral link that still reaches the studio. Claimed 21 Nov.
--
-- Safe to run twice: every statement is create or replace / if not exists.
--
-- ── 1. The Leads pages: no new index ─────────────────────────────────────
-- Measured on 5,000 leads in 3 studios (one with ~2,050 open, live leads),
-- then again with 6,000 more closed leads in that studio, every query run as
-- the API runs it (authenticated, RLS on). Every read already scans an index,
-- company_id first:
--   page (urgency, newest), list total, board columns, counts
--       -> crm_leads_sla_idx (company_id, sla_due_at)
--          where status not in ('converted', 'lost') and is_archived = false,
--          which is exactly the open, live set the Leads page reads;
--   a column's Show more (stage_id = ?) -> crm_leads_stage_idx (company_id, stage_id);
--   view=today / overdue -> crm_leads_followup_idx (company_id, follow_up_at).
-- The urgency order cannot come from an index: its rank (late, today, never
-- rung, upcoming) is measured from the viewer's midnight, a parameter. The
-- candidates tried -- (company_id, stage_id, created_at desc, id desc) and
-- (company_id, created_at desc, id desc) on the open set, and a covering
-- (company_id) include (status, follow_up_at, ...) for counts -- were either
-- not chosen or saved under half a millisecond, so none is added: crm_leads
-- already carries 21 indexes and every one is paid on each write.
--
-- What did cost time was the board's query shape: it built every open lead's
-- card (events, tags, six joins) before keeping 31 per stage, and its cost
-- estimate crossed Postgres's JIT threshold (jit_above_cost 100000), so each
-- open of the board compiled the plan: 66-88 ms, ~50 of them JIT (14 ms
-- without the closed history). selectColumns (services/api/src/modules/crm/
-- lead-pages.ts) now ranks the bare rows and builds only the kept cards: 5 ms. Keep crm_leads_sla_idx's predicate as it
-- is -- the Leads pages lean on it.

-- ── 2. An ended referral link still reaches the studio ───────────────────
-- A friend who opens a client's referral card after the offer ended (the
-- campaign paused, ended or archived, or its valid_until passed) used to meet
-- "This referral link does not open" and the studio lost the enquiry. The page
-- now shows the studio and a plain form; the enquiry becomes a lead.

-- get_public_referral_campaign: copied from 0067_referral_slug.sql; an offer
-- past its valid_until (0298) is no longer active (1), nothing else changed.
create or replace function get_public_referral_campaign(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'campaign_id', rc.id,
    'name', rc.name,
    'description', rc.description,
    'reward_type', rc.reward_type,
    'reward_value', rc.reward_value,
    'reward_description', rc.reward_description,
    'studio_name', co.display_name
  )
  from referral_campaigns rc
  join companies co on co.id = rc.company_id
  where rc.slug = p_slug and rc.status = 'active'
    and (rc.valid_until is null or rc.valid_until >= india_today())
$$;

revoke all on function get_public_referral_campaign(text) from public, anon;
grant execute on function get_public_referral_campaign(text) to anon, authenticated;

-- submit_referral: copied from 0082_referral_event_fields.sql; an offer past
-- its valid_until cannot be claimed (1), nothing else changed.
create or replace function submit_referral(
  p_campaign_id     uuid,
  p_client_name     text,
  p_referrer_name   text default null,
  p_referrer_phone  text default null,
  p_client_phone    text default null,
  p_client_email    text default null,
  p_notes           text default null,
  p_event_type      text default null,
  p_event_date      date default null,
  p_functions_count int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_id      uuid;
  v_campaign referral_campaigns;
begin
  select * into v_campaign from referral_campaigns where id = p_campaign_id and status = 'active'
     and (valid_until is null or valid_until >= india_today());
  if v_campaign.id is null then
    raise exception 'campaign not found or inactive' using errcode = 'P0001';
  end if;
  v_company := v_campaign.company_id;

  -- Duplicate check: same phone or email within the same campaign
  if p_client_phone is not null or p_client_email is not null then
    if exists (
      select 1 from referral_submissions
      where campaign_id = p_campaign_id
        and (
          (p_client_phone is not null and client_phone = p_client_phone) or
          (p_client_email is not null and client_email = p_client_email)
        )
    ) then
      raise exception 'duplicate referral' using errcode = '23505';
    end if;
  end if;

  insert into referral_submissions (
    company_id, campaign_id, referrer_name, referrer_phone, client_name, client_phone, client_email, notes,
    event_type, event_date, functions_count
  )
  values (
    v_company, p_campaign_id, p_referrer_name, p_referrer_phone, p_client_name, p_client_phone, p_client_email, p_notes,
    p_event_type, p_event_date, p_functions_count
  )
  returning id into v_id;

  -- Increment click counter on the link
  update referral_links set clicks = clicks + 1 where campaign_id = p_campaign_id;

  return v_id;
end;
$$;

revoke all on function submit_referral(uuid, text, text, text, text, text, text, text, date, int) from public, anon;
grant execute on function submit_referral(uuid, text, text, text, text, text, text, text, date, int) to anon;
grant execute on function submit_referral(uuid, text, text, text, text, text, text, text, date, int) to authenticated;

-- Who a referral link belongs to, ended or not: the studio's name and logo and
-- whether its offer is still open. Nothing private -- no offer, no client, no
-- counts. Null when no campaign has this slug.
create or replace function get_public_referral_studio(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'campaign_id', rc.id,
    'studio_name', coalesce(nullif(btrim(co.display_name), ''), co.name),
    'logo_url', coalesce(nullif(co.invoice_logo_url, ''), nullif(co.avatar_url, '')),
    'active', rc.status = 'active' and (rc.valid_until is null or rc.valid_until >= india_today())
  )
  from referral_campaigns rc
  join companies co on co.id = rc.company_id
  where rc.slug = p_slug
$$;

revoke all on function get_public_referral_studio(text) from public, anon, authenticated;
grant execute on function get_public_referral_studio(text) to service_role;

-- A friend's enquiry through a link whose offer has ended: a plain lead for
-- the studio (source 'referral', marked offer_ended, still credited to the
-- client who shared it) and the owner's bell, as a referral rings it. No
-- referral_submissions row: nothing was claimed, so no reward falls due.
-- Raises 'not found' for an unknown slug and 'still active' for a live offer
-- (that one goes through submit_referral).
create or replace function submit_ended_referral_enquiry(
  p_slug    text,
  p_name    text,
  p_phone   text,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c        record;
  v_referrer text;
  v_lead     uuid;
  v_name     text := left(btrim(coalesce(p_name, '')), 160);
  v_phone    text := left(btrim(coalesce(p_phone, '')), 40);
  v_message  text := nullif(left(btrim(coalesce(p_message, '')), 2000), '');
begin
  select rc.id, rc.company_id, rc.client_id, co.owner_user_id,
         rc.status = 'active' and (rc.valid_until is null or rc.valid_until >= india_today()) as active
    into v_c
    from referral_campaigns rc
    join companies co on co.id = rc.company_id
   where rc.slug = p_slug;
  if v_c.id is null then
    raise exception 'referral link not found' using errcode = 'P0002';
  end if;
  if v_c.active then
    raise exception 'referral offer still active' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 2 or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then
    raise exception 'name and phone are required' using errcode = '22023';
  end if;

  -- Who sent the friend: the card's own client, else whoever last sent one
  -- through this link (as GET /public/referrals/campaign/:slug names them).
  v_referrer := coalesce(
    (select cl.name from clients cl where cl.id = v_c.client_id),
    (select rs.referrer_name from referral_submissions rs
      where rs.campaign_id = v_c.id and rs.referrer_name is not null
      order by rs.created_at desc limit 1));
  v_referrer := left(nullif(btrim(v_referrer), ''), 160);

  insert into crm_leads (company_id, name, phone, source, notes, referred_by_name, source_meta)
  values (v_c.company_id, v_name, v_phone, 'referral',
          concat_ws(' · ',
            case when v_referrer is not null
                 then 'Came through ' || v_referrer || '''s referral link after the offer ended (no offer applies)'
                 else 'Came through a referral link after the offer ended (no offer applies)' end,
            v_message),
          v_referrer,
          jsonb_build_object('referral_campaign_id', v_c.id, 'offer_ended', true))
  returning id into v_lead;

  if v_c.owner_user_id is not null then
    insert into notifications (company_id, recipient_uid, type, title, body, entity_type, entity_id, dedupe_key)
    values (v_c.company_id, v_c.owner_user_id, 'referral', 'New enquiry from a referral link',
            v_name || ' wrote in through ' || coalesce(v_referrer || '''s', 'a') || ' referral link. The offer had ended, so none applies.',
            'crm_lead', v_lead, 'referral_ended:' || v_lead)
    on conflict do nothing;
  end if;

  return v_lead;
end;
$$;

revoke all on function submit_ended_referral_enquiry(text, text, text, text) from public, anon, authenticated;
grant execute on function submit_ended_referral_enquiry(text, text, text, text) to service_role;
