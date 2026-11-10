-- 0298: referral cards (owner, 10 Nov). Every booked client gets a card to
-- forward to friends; the friend gets an offer for booking through it, and the
-- client who referred is rewarded once the friend books.
--
--   1. The friend's offer on a referral campaign (0052/0102 carried only the
--      referrer's reward), and how long the card is good for.
--   2. referral_settings: the studio's defaults, so a new campaign (one per
--      project, 0102's unique index) starts filled.
--   3. crm_leads.referral_submission_id / referred_by_name: the lead a friend's
--      enquiry made, linked back (the API wrote the lead and forgot the link).
--   4. Booked -> reward due: a lead that came by a card and is converted marks
--      its referral booked with the reward due, and rings the bell; reopened
--      before the reward was given, it goes back to not due.
--   5. referral_offer_for_project(): what billing reads to put the friend's
--      offer on their first invoice.
--   6. referral_card_opened(): the card's page opens, counted (the old
--      referral_links.clicks update counted nothing -- no row is ever made).
--
-- Safe to run twice.

-- ── 1. the friend's offer ─────────────────────────────────────────────
alter table referral_campaigns add column if not exists friend_reward_type text not null default 'none';
alter table referral_campaigns add column if not exists friend_reward_value numeric(12,2) not null default 0;
alter table referral_campaigns add column if not exists friend_reward_title text;
alter table referral_campaigns add column if not exists valid_until date;
alter table referral_campaigns add column if not exists views int not null default 0;
alter table referral_campaigns drop constraint if exists referral_campaigns_friend_reward_type_check;
alter table referral_campaigns add constraint referral_campaigns_friend_reward_type_check
  check (friend_reward_type in ('none', 'fixed', 'percentage', 'free_addon'));
alter table referral_campaigns drop constraint if exists referral_campaigns_friend_reward_value_check;
alter table referral_campaigns add constraint referral_campaigns_friend_reward_value_check
  check (friend_reward_value >= 0 and (friend_reward_type <> 'percentage' or friend_reward_value <= 100));
alter table referral_campaigns drop constraint if exists referral_campaigns_friend_reward_title_check;
alter table referral_campaigns add constraint referral_campaigns_friend_reward_title_check
  check (friend_reward_title is null or char_length(friend_reward_title) <= 120);

-- ── 2. the studio's defaults ─────────────────────────────────────────
create table if not exists referral_settings (
  company_id           uuid primary key default get_current_company_id() references companies (id) on delete cascade,
  is_on                boolean not null default true,
  reward_type          text not null default 'fixed',
  reward_value         numeric(12,2) not null default 0 check (reward_value >= 0),
  reward_title         text check (reward_title is null or char_length(reward_title) <= 120),
  friend_reward_type   text not null default 'fixed'
                       check (friend_reward_type in ('none', 'fixed', 'percentage', 'free_addon')),
  friend_reward_value  numeric(12,2) not null default 0
                       check (friend_reward_value >= 0),
  friend_reward_title  text check (friend_reward_title is null or char_length(friend_reward_title) <= 120),
  valid_days           int not null default 180 check (valid_days between 7 and 1095),
  card_look            text not null default 'ivory' check (char_length(card_look) <= 30),
  updated_at           timestamptz not null default now()
);
alter table referral_settings enable row level security;
drop policy if exists referral_settings_select on referral_settings;
create policy referral_settings_select on referral_settings
  for select using (company_id = get_current_company_id());
drop policy if exists referral_settings_write on referral_settings;
create policy referral_settings_write on referral_settings
  for all using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
grant select, insert, update, delete on referral_settings to authenticated;

-- ── 3. the friend's lead, linked ─────────────────────────────────────
alter table crm_leads add column if not exists referral_submission_id uuid
  references referral_submissions (id) on delete set null;
alter table crm_leads add column if not exists referred_by_name text
  check (referred_by_name is null or char_length(referred_by_name) <= 160);
create index if not exists crm_leads_referral_submission_idx on crm_leads (referral_submission_id)
  where referral_submission_id is not null;

-- ── 4. booked -> reward due ──────────────────────────────────────────
create or replace function crm_leads_referral_booked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_owner uuid;
  v_maker uuid;
begin
  if new.referral_submission_id is null then return new; end if;

  if new.status = 'converted' and old.status is distinct from 'converted' then
    update referral_submissions
       set status = 'booked',
           reward_status = case when reward_status in ('given', 'cancelled') then reward_status else 'due' end,
           updated_at = now()
     where id = new.referral_submission_id
    returning id, company_id, campaign_id, coalesce(referring_client_name, referrer_name) as referrer
      into v_sub;
    if v_sub.id is null then return new; end if;

    select c.owner_user_id into v_owner from companies c where c.id = new.company_id;
    select p.created_by into v_maker
      from referral_campaigns rc join projects p on p.id = rc.project_id
     where rc.id = v_sub.campaign_id;
    insert into notifications (company_id, recipient_uid, type, title, body, entity_type, entity_id, dedupe_key)
    select new.company_id, u, 'referral',
           format('%s booked through %s''s card', coalesce(new.name, 'A friend'), coalesce(v_sub.referrer, 'a client')),
           format('%s''s reward is due. Give it from Referrals → Rewards.', coalesce(v_sub.referrer, 'Your client')),
           'referral_submission', v_sub.id,
           'referral_booked:' || v_sub.id::text
      from (select distinct x from unnest(array[v_owner, v_maker]) x where x is not null) r(u)
    on conflict (company_id, recipient_uid, dedupe_key) do nothing;

  elsif old.status = 'converted' and new.status is distinct from 'converted' then
    update referral_submissions
       set reward_status = 'not_due', updated_at = now()
     where id = new.referral_submission_id and reward_status = 'due';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_referral_booked on crm_leads;
create trigger crm_leads_referral_booked after update of status on crm_leads
  for each row execute function crm_leads_referral_booked();

-- ── 5. the friend's offer, for their invoice ─────────────────────────
-- The lead that became this project, if a friend's card brought it, and the
-- offer that card made. Read with the caller's rights: RLS keeps it in-studio.
create or replace function referral_offer_for_project(p_project uuid)
returns table (
  referrer text,
  friend_reward_type text,
  friend_reward_value numeric,
  friend_reward_title text
)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(l.referred_by_name, s.referring_client_name, s.referrer_name, cl.name),
         rc.friend_reward_type, rc.friend_reward_value, rc.friend_reward_title
    from crm_leads l
    join referral_submissions s on s.id = l.referral_submission_id
    join referral_campaigns rc on rc.id = s.campaign_id
    left join clients cl on cl.id = rc.client_id
   where l.converted_project_id = p_project
     and rc.friend_reward_type <> 'none'
   order by l.updated_at desc
   limit 1
$$;
revoke all on function referral_offer_for_project(uuid) from public, anon;
grant execute on function referral_offer_for_project(uuid) to authenticated, service_role;

-- ── 6. the card's page opened ────────────────────────────────────────
create or replace function referral_card_opened(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update referral_campaigns set views = views + 1 where slug = p_slug and status = 'active'
$$;
revoke all on function referral_card_opened(text) from public;
grant execute on function referral_card_opened(text) to anon, authenticated, service_role;
