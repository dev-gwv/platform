-- 0294: bug sweep (owner, 6 Nov: "go deep and find the bugs, then fix them").
-- Each function below is copied from its latest definition and changed only
-- where the comment says. Safe to run twice.

-- ── 1. Inbox proof is its own fact ──────────────────────────────────
-- email_verified is also set by a studio for a team login it makes (any
-- email is a username there), so it never proved a mailbox. A studio could
-- add a login for an email another studio had invited, sign in, and join
-- that studio through "pending invite"; or pre-make a login for an email
-- named a platform admin. email_proven_at is set only by the confirmation
-- link, a password reset and Google (the API, auth/router.ts).
alter table auth.users add column if not exists email_proven_at timestamptz;

-- Those already proven: the people who signed their own studio up and
-- confirmed it, and the platform admins. Team logins prove theirs on their
-- next reset or Google sign-in.
update auth.users au
   set email_proven_at = coalesce(au.email_verified_at, now())
 where au.email_proven_at is null
   and au.identity_id is null
   and au.email_verified
   and (exists (select 1 from platform_admins pa where pa.user_id = au.id)
        or exists (select 1 from companies c where c.owner_user_id = au.id));

-- claim_platform_admin (0291): only a proven inbox.
create or replace function claim_platform_admin(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth_identity_of(p_user);
begin
  if v_id is null or not exists (
       select 1 from auth.users au
         join platform_admin_emails e on e.email = lower(trim(au.email))
        where au.id = v_id and au.email_proven_at is not null) then
    return false;
  end if;
  insert into platform_admins (user_id) values (v_id) on conflict do nothing;
  return true;
end;
$$;
revoke all on function claim_platform_admin(uuid) from public, anon, authenticated;
grant execute on function claim_platform_admin(uuid) to service_role;


-- join_invitation_as (0250): only a proven inbox joins an invitation.
create or replace function join_invitation_as(p_identity uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_inv   user_invitations%rowtype;
  v_user  uuid;
  v_role  uuid;
begin
  -- Only a real login whose mailbox is proved.
  select email into v_email
    from auth.users
   where id = p_identity and identity_id is null and email is not null and email_verified
     and email_proven_at is not null;
  if v_email is null then
    return null;
  end if;

  select * into v_inv
    from user_invitations
   where lower(email) = lower(v_email)
     and accepted_at is null
     and revoked_at is null
     and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if v_inv.id is null then
    return null;
  end if;

  select p.profile_id into v_user
    from list_login_profiles(p_identity) p
   where p.company_id = v_inv.company_id;
  if v_user is null then
    insert into auth.users (email, encrypted_password, email_verified, email_verified_at, identity_id)
    values (null, null, true, now(), p_identity)
    returning id into v_user;
  end if;

  if not exists (select 1 from users where user_id = v_user) then
    insert into users (
      user_id, company_id, role, name, email, phone, alternate_phone,
      status, employee_type, salary, address, engagement_type, login_enabled
    ) values (
      v_user, v_inv.company_id, v_inv.role, v_inv.pending_name, v_inv.email,
      v_inv.pending_phone, v_inv.pending_alternate_phone,
      'active',
      case when v_inv.role = 'employee' then 1 else 2 end,
      v_inv.pending_salary, v_inv.pending_address, v_inv.pending_engagement_type, true
    );
  end if;

  foreach v_role in array v_inv.pending_role_ids loop
    insert into employee_role_assignments (user_id, role_id, company_id)
    values (v_user, v_role, v_inv.company_id)
    on conflict do nothing;
  end loop;

  update user_invitations
     set accepted_at = now(), accepted_by = v_user
   where id = v_inv.id;

  return v_user;
end;
$$;
revoke all on function join_invitation_as(uuid) from public, anon, authenticated;
grant execute on function join_invitation_as(uuid) to service_role;


-- ── 2. Ids from another studio are refused on invoices and bookings ──
-- create_invoice / update_invoice and book_team_slot are security definer and
-- never checked a client, project, shoot or person against the caller's
-- studio; the public invoice link then showed that studio's client. One
-- trigger each, so every path is covered.
create or replace function invoices_same_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null and not exists (
       select 1 from clients where id = new.client_id and company_id = new.company_id) then
    raise exception 'That client is not in this studio.' using errcode = '42501';
  end if;
  if new.project_id is not null and not exists (
       select 1 from projects where id = new.project_id and company_id = new.company_id) then
    raise exception 'That project is not in this studio.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_same_company on invoices;
create trigger invoices_same_company
  before insert or update of client_id, project_id on invoices
  for each row execute function invoices_same_company();

-- Money on an invoice follows the invoice when it moves to another project,
-- so it is never counted on one project while settling another's invoice.
create or replace function invoices_move_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is not null and new.project_id is distinct from old.project_id then
    update received_payments
       set project_id = new.project_id
     where invoice_id = new.id and company_id = new.company_id
       and project_id is distinct from new.project_id;
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_move_payments on invoices;
create trigger invoices_move_payments
  after update of project_id on invoices
  for each row execute function invoices_move_payments();

create or replace function team_slots_same_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shoot_id is not null and not exists (
       select 1 from shoots where id = new.shoot_id and company_id = new.company_id) then
    raise exception 'That shoot is not in this studio.' using errcode = '42501';
  end if;
  if new.user_id is not null and not exists (
       select 1 from users where user_id = new.user_id and company_id = new.company_id) then
    raise exception 'That person is not in this studio.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists team_slots_same_company on team_assignment_slots;
create trigger team_slots_same_company
  before insert or update of shoot_id, user_id on team_assignment_slots
  for each row execute function team_slots_same_company();


-- ── 3. A crew payment: locked, and Undo only once (0090) ─────────────
create or replace function create_payout_settlement(
  p_slot_id               uuid,
  p_amount_paid           numeric,
  p_paid_date             date default current_date,
  p_payment_mode          text default null,
  p_payment_reference     text default null,
  p_notes                 text default null,
  p_entry_type            text default 'payment',
  p_reverses_settlement_id uuid default null
)
returns table (id uuid, paid_total numeric, amount_due numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company        uuid := get_current_company_id();
  v_slot           team_assignment_slots;
  v_amount_due     numeric;
  v_current_paid   numeric;
  v_delta          numeric;
  v_projected      numeric;
  v_project_id     uuid;
  v_id             uuid;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_entry_type not in ('payment', 'reversal', 'adjustment') then
    raise exception 'invalid entry_type';
  end if;
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'amount_paid must be > 0';
  end if;

  -- Locked: two payments at once (a double tap) both passed the "more than
  -- due" check and paid twice (0294).
  select * into v_slot from team_assignment_slots
   where team_assignment_slots.id = p_slot_id and company_id = v_company
   for update;
  if v_slot.id is null then
    raise exception 'slot not found' using errcode = '42501';
  end if;

  v_amount_due := coalesce(v_slot.final_cost, v_slot.estimated_cost, 0);
  select project_id into v_project_id from shoots where shoots.id = v_slot.shoot_id;

  select coalesce(sum(amount_paid), 0) into v_current_paid
    from team_slot_settlements where slot_id = p_slot_id;

  -- A reversal undoes one payment on this booking, once, and no more than it
  -- was (0294: Undo pressed twice wiped a second, real payment).
  if p_entry_type = 'reversal' and p_reverses_settlement_id is not null then
    if not exists (
         select 1 from team_slot_settlements s
          where s.id = p_reverses_settlement_id and s.slot_id = p_slot_id
            and s.entry_type = 'payment' and s.amount_paid >= p_amount_paid - 0.001) then
      raise exception 'that payment is not on this booking' using errcode = '23514';
    end if;
    if exists (select 1 from team_slot_settlements s
                where s.reverses_settlement_id = p_reverses_settlement_id) then
      raise exception 'that payment was already undone' using errcode = '23505';
    end if;
  end if;

  v_delta := case when p_entry_type = 'reversal' then -p_amount_paid else p_amount_paid end;
  v_projected := v_current_paid + v_delta;

  if p_entry_type = 'reversal' and v_projected < 0 then
    raise exception 'reversal would make the paid total negative';
  end if;
  if p_entry_type = 'payment' and v_amount_due > 0 and v_projected > v_amount_due + 0.001 then
    raise exception 'payment would exceed amount due (%)', v_amount_due;
  end if;

  insert into team_slot_settlements (
    company_id, slot_id, member_uid, project_id, shoot_id,
    amount_due, amount_paid, paid_date, payment_mode, payment_reference, notes,
    entry_type, reverses_settlement_id, created_by
  ) values (
    v_company, p_slot_id, v_slot.user_id, v_project_id, v_slot.shoot_id,
    v_amount_due, v_delta, coalesce(p_paid_date, (now() at time zone 'Asia/Kolkata')::date), p_payment_mode, p_payment_reference, p_notes,
    p_entry_type, p_reverses_settlement_id, auth.uid()
  ) returning team_slot_settlements.id into v_id;

  return query select v_id, v_projected, v_amount_due;
end;
$$;
revoke all on function create_payout_settlement(uuid, numeric, date, text, text, text, text, uuid) from public, anon;
grant execute on function create_payout_settlement(uuid, numeric, date, text, text, text, text, uuid) to authenticated;


-- ── 4. A ₹0 invoice no longer flips to Paid (0284) ──────────────────
create or replace function recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid  numeric;
begin
  if p_invoice_id is null then return; end if;
  select total into v_total from invoices where id = p_invoice_id;
  if v_total is null then return; end if;
  -- Only money in hand. A row marked `pending` is a promise, which is what
  -- the payments screen calls "what is still pending" — an invoice settled by
  -- one of those would be reporting a payment nobody has received.
  select coalesce(sum(amount), 0) into v_paid
    from received_payments
   where invoice_id = p_invoice_id and status = 'paid';
  update invoices
     set amount_paid = v_paid,
         balance_due = case when status = 'cancelled' then 0 else greatest(0, v_total - v_paid) end,
         status = case
                    -- A cancelled invoice stays cancelled (0284); it is
                    -- reopened on purpose, never by a payment landing on it.
                    when status = 'cancelled' then status
                    -- A ₹0 invoice is not paid by nothing (0294).
                    when v_total > 0 and v_paid >= v_total then 'paid'
                    when v_paid > 0 then 'partial'
                    -- Back to its pre-payment state if every payment is
                    -- removed; 'sent' rather than 'draft', because an
                    -- invoice that has been paid was certainly sent.
                    else case when status in ('paid', 'partial') then 'sent' else status end
                  end
   where id = p_invoice_id;
end;
$$;


-- ── 5. Book it twice books once (0149) ──────────────────────────────
create or replace function convert_lead_to_project(
  p_lead      uuid,
  p_client_id uuid default null,
  p_client    jsonb default '{}'::jsonb,
  p_project   jsonb default null,
  p_quote     uuid default null
)
returns table (client_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_lead    crm_leads;
  v_quote   crm_quotes;
  v_client  uuid := p_client_id;
  v_project uuid;
  v_name    text;
  v_cost    numeric;
  v_items   jsonb := '[]'::jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Locked: Book it pressed twice made two clients and two projects (0294).
  select * into v_lead from crm_leads where id = p_lead and company_id = v_company for update;
  if not found then
    raise exception 'unknown lead' using errcode = '42501';
  end if;
  -- Either kind of conversion counts. Testing only the project left the
  -- client-only path converting over and over, a new client each time.
  if v_lead.converted_project_id is not null or v_lead.converted_client_id is not null then
    raise exception 'already converted' using errcode = '22023';
  end if;
  if v_lead.phone is null or btrim(v_lead.phone) = '' then
    raise exception 'Add a phone number before converting — it is how the client is found again.' using errcode = 'P0001';
  end if;
  if p_quote is not null then
    select * into v_quote from crm_quotes where id = p_quote and lead_id = p_lead and company_id = v_company;
    if not found then raise exception 'unknown quote' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', i.description, 'list_key', 'primary', 'visibility_scope', 'client', 'show_on_quotation', true,
             'description', case when i.quantity <> 1 then i.quantity::text || ' × ' || i.rate::text else null end
           ) order by i.sort_order), '[]'::jsonb)
      into v_items
      from crm_quote_items i where i.quote_id = p_quote;
  end if;

  if v_client is null then
    insert into clients (company_id, name, email, phone, alternate_phone, address, city, notes, created_by)
    values (
      v_company,
      coalesce(nullif(p_client->>'name', ''), v_lead.name, v_lead.phone, 'New client'),
      coalesce(nullif(p_client->>'email', ''), v_lead.email),
      coalesce(nullif(p_client->>'phone', ''), v_lead.phone),
      nullif(p_client->>'alternate_phone', ''),
      nullif(p_client->>'address', ''),
      nullif(p_client->>'city', ''),
      nullif(p_client->>'notes', ''),
      auth.uid()
    )
    returning id into v_client;
  elsif not exists (select 1 from clients where id = v_client and company_id = v_company) then
    raise exception 'unknown client' using errcode = '42501';
  end if;

  -- Client-only convert: no project (and no quote) — the lead is won and
  -- linked to the client; the project comes later. converted_project_id
  -- stays null, which the UI reads as "client converted, project pending",
  -- and converted_client_id is what says which client that is.
  if (p_project is null or p_project = '{}'::jsonb) and p_quote is null then
    update crm_leads
       set status = 'converted', converted_project_id = null, converted_client_id = v_client
     where id = p_lead;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_company, p_lead, null, null, auth.uid(), 'converted to client (no project yet)');
    return query select v_client, null::uuid;
    return;
  end if;

  v_name := coalesce(nullif(p_project->>'name', ''), v_quote.title, v_lead.title, coalesce(v_lead.name, 'New') || ' project');
  v_cost := coalesce((p_project->>'package_cost')::numeric, v_quote.total, v_lead.deal_value, 0);
  v_project := create_project_with_details(
    v_client,
    v_name,
    v_cost,
    coalesce(nullif(p_project->>'status', ''), 'active'),
    p_quote is not null,
    v_items,
    '[]'::jsonb
  );

  update crm_leads
     set status = 'converted', converted_project_id = v_project, converted_client_id = v_client
   where id = p_lead;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(),
          'converted to project: ' || v_name || case when v_quote.id is not null then ' (from quote ' || v_quote.quote_number || ')' else '' end);

  return query select v_client, v_project;
end;
$$;
revoke all on function convert_lead_to_project(uuid, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function convert_lead_to_project(uuid, uuid, jsonb, jsonb, uuid) to authenticated;


-- ── 6. Work in review with no stage is not shown to the client as ready (0252)
-- A deleted review stage, or a status set without one, read as "ready" with
-- its link.
create or replace function client_portal_status(p_status text, p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p_status = 'completed' then 'delivered'
           when p_status = 'review' and p_code in ('approved', 'with_client', 'client_approved') then 'ready'
           when p_status = 'review' then 'final_checks'
           when p_status = 'in_progress' then 'in_progress'
           else 'not_started'
         end
$$;


-- ── 7. Checking out of a shoot day never makes it a half day (0224) ─
create or replace function check_out(p_lat double precision default null, p_lng double precision default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
  v_hours   numeric;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select half_day_hours into v_hours from attendance_policy where company_id = v_company;

  update attendance a
     set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
         -- Under the studio's half-day hours is a half day -- unless half the
         -- day was approved leave, which is the other half.
         status = case
                    -- A shoot day is never cut (0294): "I've reached" then check out.
                    when v_hours is not null and a.status in ('present', 'late')
                         and coalesce(a.source, '') <> 'shoot'
                         and now() - a.check_in_at < make_interval(mins => (v_hours * 60)::int)
                         and not exists (select 1 from leave_requests lr
                                          where lr.user_id = a.user_id and lr.status = 'approved' and lr.half_day
                                            and lr.start_date = a.a_date)
                    then 'half_day' else a.status end
   where a.id = (
           select x.id
             from attendance x
            where x.company_id = v_company
              and x.user_id = auth.uid()
              and x.check_in_at is not null
              and x.check_out_at is null
              and x.check_in_at > now() - interval '20 hours'
            order by x.check_in_at desc
            limit 1
            for update)
  returning a.id into v_id;

  if v_id is null then
    raise exception 'no_open_check_in: nothing to check out of'
      using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;
revoke all on function check_out(double precision, double precision) from public, anon;
grant execute on function check_out(double precision, double precision) to authenticated;


-- ── 8. A repeat Facebook / web lead is never silently dropped (0196) ─
create or replace function capture_lead(
  p_source_key text,
  p_name       text,
  p_phone      text,
  p_email      text default null,
  p_meta       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   crm_webhook_sources;
  v_norm     text := crm_normalize_phone(p_phone);
  v_existing uuid;
  v_assignee uuid;
  v_lead     uuid;
  v_default_pipeline uuid;
  v_stage    uuid;
begin
  select * into v_source from crm_webhook_sources
    where source_key = p_source_key and is_active;
  if not found then
    raise exception 'unknown or inactive source' using errcode = '42501';
  end if;

  update crm_webhook_sources set last_received_at = now() where id = v_source.id;

  -- The same number while its lead is open: no second lead, a note on that
  -- one and whoever has it is told -- the rule the enquiry form keeps (0281).
  -- A lost, booked, archived or merged lead is not "open": a new enquiry from
  -- that number is a new lead, never silently dropped (0294).
  if v_norm is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_source.company_id::text || ':' || v_norm, 0));
    select id, assigned_to into v_existing, v_assignee from crm_leads l
      where l.company_id = v_source.company_id and l.phone_norm = v_norm
        and l.merged_into is null
        and coalesce(l.is_archived, false) = false
        and l.status not in ('converted', 'lost')
      order by l.created_at desc
      limit 1;
    if v_existing is not null then
      insert into crm_activities (company_id, lead_id, type, direction, subject, body, meta)
      values (v_source.company_id, v_existing, 'note', 'in', 'Enquired again',
              'Came in again through ' || coalesce(v_source.label, v_source.kind, 'a lead source'),
              jsonb_build_object('source_key', v_source.source_key));
      if v_assignee is not null then
        perform create_notification(
          v_source.company_id, v_assignee, 'enquiry_again', 'Enquired again: ' || coalesce(p_name, p_phone, 'a lead'),
          coalesce(v_source.label, v_source.kind, ''),
          'enquiry_again:' || v_existing || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
          'lead', v_existing, 'info', '/follow-ups?lead=' || v_existing, '{}'::jsonb);
      end if;
      return v_existing;
    end if;
  end if;

  -- Per-source default assignee wins; otherwise the rota decides (0196).
  v_assignee := v_source.default_assigned_to;
  if v_assignee is null then
    v_assignee := crm_pick_assignee(v_source.company_id);
  end if;

  insert into crm_leads (
    company_id, name, phone, phone_norm, email, source, source_key, assigned_to, source_meta, quality
  )
  values (
    v_source.company_id, p_name, p_phone, v_norm, p_email,
    coalesce(v_source.default_source, case when v_source.kind = 'meta' then 'facebook' else 'webform' end),
    v_source.source_key, v_assignee, coalesce(p_meta, '{}'::jsonb),
    v_source.default_quality
  )
  returning id into v_lead;

  -- Per-source default stage (a legacy status key like 'contacted').
  if v_source.default_stage is not null then
    select id into v_default_pipeline from crm_pipelines
     where company_id = v_source.company_id and is_default;
    if v_default_pipeline is not null then
      v_stage := crm_stage_for_status(v_default_pipeline, v_source.default_stage);
      if v_stage is not null then
        update crm_leads set stage_id = v_stage where id = v_lead;
      end if;
    end if;
  end if;

  return v_lead;
end;
$$;


-- ── 9. Every studio's usage is for platform admins only (0117) ──────
create or replace function platform_usage_detailed(p_days int default 30)
returns table (
  company_id uuid, company_name text, owner_email text,
  active_today bigint, active_week bigint, active_month bigint,
  sessions_30d bigint, events_30d bigint, last_seen timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name,
         (select u.email from users u where u.user_id = c.owner_user_id),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - interval '1 day'),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - interval '7 days'),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - interval '30 days'),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - make_interval(days => p_days)),
         (select count(*) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - make_interval(days => p_days)),
         (select max(ue.occurred_at) from usage_events ue where ue.company_id = c.id) as last_seen
    from companies c
   -- Every studio's owner email and activity: platform admins only (0294).
   where is_platform_admin()
   order by last_seen desc nulls last
   limit 500;
$$;

-- ── 10. A Facebook lead brought in once is found quickly on a resend ──
create index if not exists fb_lead_imports_leadgen_idx on fb_lead_imports (leadgen_id) where leadgen_id is not null;
