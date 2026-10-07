-- The old app's data, studio by studio, into this one.
--
-- Run after load.sql (which fills legacy.src and legacy.blobs). Everything is
-- in the `legacy` schema, so dropping that schema removes the importer and
-- leaves only what it imported and public.legacy_imports / legacy_logins (0249).
--
--   select legacy.import_all();          -- every studio not yet done
--   select * from legacy.report;         -- old count vs new count, per studio
--
-- Rules it keeps (README.md has the why):
--   * old ids are kept for every business row, so links between rows survive;
--     only people get new ids (the old app keyed them by Firebase uid);
--   * a studio whose owner already made one here is merged into it, never
--     doubled; a studio with nothing in it is recorded as skipped_empty;
--   * one studio is one sub-transaction: a failure rolls back that studio only
--     and is written to legacy_imports with its error;
--   * the app's own triggers run (receipt numbers, invoice balances, CRM
--     contacts...), but nothing the import makes may notify or message anyone,
--     and no plan limit applies while it runs.

create schema if not exists legacy;

-- Where /public/files/:id is served; the app stores the absolute URL.
create or replace function legacy.api_origin() returns text language sql immutable as
$$ select 'https://api.studioautopilot.in' $$;

-- Columns each public table can take (generated ones excluded).
drop table if exists legacy.cols;
create table legacy.cols as
select table_name::text as tbl, array_agg(column_name::text order by ordinal_position) as cols
  from information_schema.columns
 where table_schema = 'public' and is_generated = 'NEVER'
 group by table_name;

-- Old firebase uid -> new users.user_id, per old studio.
create table if not exists legacy.person (
  old_company uuid not null,
  old_uid     text not null,
  user_id     uuid not null,
  primary key (old_company, old_uid)
);

-- Old id -> the row it became, where a merge reused an existing row
-- (a service, role, disk or category the studio already had here).
create table if not exists legacy.idmap (
  old_company uuid not null,
  kind        text not null,
  old_id      text not null,
  new_id      uuid not null,
  primary key (old_company, kind, old_id)
);

-- Insert one jsonb object into a public table: only keys that are columns,
-- JSON nulls left out so column defaults apply.
create or replace function legacy.put(p_tbl text, j jsonb, p_on_conflict_skip boolean default false)
returns void language plpgsql as $$
declare
  c text;
begin
  select string_agg(quote_ident(x), ',') into c
    from unnest((select cols from legacy.cols where tbl = p_tbl)) x
   where j ? x and jsonb_typeof(j -> x) <> 'null';
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)%3$s',
                 p_tbl, c, case when p_on_conflict_skip then ' on conflict do nothing' else '' end)
    using j;
end $$;

-- Every old row tagged once with the studio it belongs to. Several old tables
-- carry no company_id and belong through their parent (a shoot through its
-- project, an attendance row through its person).
alter table legacy.src add column if not exists co text;
create index if not exists src_tbl_id on legacy.src (tbl, (r->>'id'));
update legacy.src set co = r->>'company_id' where co is null and r ? 'company_id';
update legacy.src s set co = p.co from legacy.src p
 where s.co is null and s.tbl in ('shoots', 'deliverables', 'deliverables_2', 'received_payments')
   and p.tbl = 'projects' and p.r->>'id' = s.r->>'project_id';
update legacy.src s set co = p.co from legacy.src p
 where s.co is null and s.tbl in ('shoot_assignments', 'shoot_services')
   and p.tbl = 'shoots' and p.r->>'id' = s.r->>'shoot_id';
update legacy.src s set co = p.co from legacy.src p
 where s.co is null and s.tbl = 'task_assignees' and p.tbl = 'tasks' and p.r->>'id' = s.r->>'task_id';
update legacy.src s set co = p.co from legacy.src p
 where s.co is null and s.tbl = 'task_bundle_items' and p.tbl = 'task_bundles' and p.r->>'id' = s.r->>'bundle_id';
update legacy.src s set co = p.co from legacy.src p
 where s.co is null and s.tbl = 'team_terms_template_roles' and p.tbl = 'team_terms_templates' and p.r->>'id' = s.r->>'template_id';
update legacy.src s set co = p.r->>'company_id'
  from (select r from legacy.src where tbl in ('employees', 'admins')) p
 where s.co is null and s.tbl in ('attendance', 'employee_role_assignments')
   and p.r->>'firebase_uid' = s.r->>'firebase_uid';
update legacy.src s set co = p.r->>'company_id'
  from (select r from legacy.src where tbl in ('employees', 'admins')) p
 where s.co is null and s.tbl = 'employee_compensation_profiles'
   and p.r->>'firebase_uid' = s.r->>'employee_firebase_uid';
create index if not exists src_tbl_co on legacy.src (tbl, co);
analyze legacy.src;

create or replace function legacy.rows(p_tbl text, p_old uuid)
returns setof jsonb language sql stable as $$
  select r from legacy.src where tbl = p_tbl and co = p_old::text
$$;

create or replace function legacy.uid(p_old uuid, p_uid text)
returns uuid language sql stable as $$
  select user_id from legacy.person where old_company = p_old and old_uid = p_uid
$$;

create or replace function legacy.mapped(p_old uuid, p_kind text, p_id text)
returns uuid language sql stable as $$
  select coalesce((select new_id from legacy.idmap where old_company = p_old and kind = p_kind and old_id = p_id),
                  nullif(p_id, '')::uuid)
$$;

create or replace function legacy.clip(t text, n int) returns text language sql immutable as
$$ select nullif(left(btrim(t), n), '') $$;

-- Terms sections as plain text, for the NOT NULL body / rendered_body columns.
create or replace function legacy.sections_text(p_sections jsonb) returns text language sql immutable as $$
  select string_agg(coalesce(s->>'title', '') || E'\n' || coalesce(s->>'body', ''), E'\n\n'
                    order by coalesce((s->>'sort_order')::int, 0))
    from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) s
   where coalesce((s->>'enabled')::boolean, true)
$$;

-- "2 TB", "500gb", "1.5" -> gigabytes; anything else unknown.
create or replace function legacy.gb(t text) returns numeric language sql immutable as $$
  select case
    when t ~* '^\s*[0-9]+(\.[0-9]+)?\s*tb\s*$' then (substring(t from '[0-9]+(?:\.[0-9]+)?'))::numeric * 1024
    when t ~* '^\s*[0-9]+(\.[0-9]+)?\s*(gb)?\s*$' then (substring(t from '[0-9]+(?:\.[0-9]+)?'))::numeric
  end
$$;

-- A date the database can hold (the old app took years like 0026).
create or replace function legacy.sane_date(t text) returns date language sql immutable as $$
  select case when t ~ '^\d{4}-' and left(t, 4)::int between 1900 and 2100 then left(t, 10)::date end
$$;

create or replace function legacy.as_json(v jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' then (v #>> '{}')::jsonb else v end
$$;

-- The login an old person signs in with: their email's identity here, made
-- (with no password; legacy_logins says Firebase still has it) when missing.
create or replace function legacy.identity_for(p_email text)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  select id into v from auth.users where lower(email) = p_email and identity_id is null;
  if v is null then
    insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
    values (p_email, null, true, now())
    returning id into v;
    insert into public.legacy_logins (user_id, email) values (v, p_email) on conflict do nothing;
  end if;
  return v;
end $$;

-- An old studio's own content: is there anything worth bringing over?
create or replace function legacy.has_data(p_old uuid) returns boolean language sql stable as $$
  select exists (select 1 from legacy.src
                  where co = p_old::text
                    and tbl in ('clients', 'projects', 'crm_leads', 'enquiries', 'leads', 'employees',
                                'invoices', 'expenses', 'storage_locations'))
$$;

-- A studio already made here by the same owner: the old app's admins' emails
-- against this app's owners and admins. Studios this importer made never count.
create or replace function legacy.merge_target(p_old uuid) returns uuid language sql stable as $$
  select coalesce(
    (select l.joined_company_id from public.legacy_studios l
      where l.old_company_id = p_old::text and l.joined_company_id is not null
        and not exists (select 1 from legacy.src s where s.tbl = 'companies' and s.r->>'id' = l.joined_company_id::text)),
    (select u.company_id
       from public.users u
       join public.companies c on c.id = u.company_id
      where u.deleted_at is null
        and (u.role in ('super_admin', 'admin') or u.user_id = c.owner_user_id)
        and lower(u.email) in (select lower(btrim(r->>'email')) from legacy.rows('admins', p_old) r)
        and not exists (select 1 from legacy.src s where s.tbl = 'companies' and s.r->>'id' = c.id::text)
      order by (u.role = 'super_admin') desc, c.created_at
      limit 1))
$$;

-- ---------------------------------------------------------------------------
-- One studio.
-- ---------------------------------------------------------------------------
create or replace function legacy.import_studio(p_old uuid, p_target uuid, p_merge boolean)
returns jsonb language plpgsql as $$
declare
  c          jsonb := (select r from legacy.src where tbl = 'companies' and r->>'id' = p_old::text);
  v_plan     text;
  v_owner    text := c->>'owner_admin_uid';
  v_used_att boolean;
  v_pipeline uuid;
  p          record;
  x          jsonb;
  v_id       uuid;
  v_ident    uuid;
  v_email    text;
  v_login    boolean;
  v_role     text;
  v_new      boolean;
  v_slug     text;
  v_num      text;
  v_counts   jsonb := '{}'::jsonb;
begin
  -- Company --------------------------------------------------------------------
  if not p_merge then
    perform legacy.put('companies',
      (c - 'owner_admin_uid' - 'razorpay_subscription_id' - 'imported_plan_key' - 'plan' - 'avatar_url' - 'invoice_logo_url')
      || jsonb_build_object('onboarding_emails_off', true, 'setup_done_at', c->'created_at'));
    -- The old app's access dates as they were (a null must stay null, not the 7-day default).
    update public.companies
       set grandfathered_until = (c->>'grandfathered_until')::timestamptz,
           plan_expiry = (c->>'plan_expiry')::timestamptz,
           grace_until = (c->>'grace_until')::timestamptz
     where id = p_target;
  else
    update public.companies t set
      display_name = coalesce(t.display_name, c->>'display_name'),
      legal_name = coalesce(t.legal_name, c->>'legal_name'),
      city = coalesce(t.city, c->>'city'),
      state = coalesce(t.state, c->>'state'),
      website = coalesce(t.website, c->>'website'),
      invoice_address = coalesce(t.invoice_address, c->>'invoice_address'),
      invoice_phone = coalesce(t.invoice_phone, c->>'invoice_phone'),
      invoice_email = coalesce(t.invoice_email, c->>'invoice_email'),
      invoice_gst_number = coalesce(t.invoice_gst_number, c->>'invoice_gst_number'),
      invoice_upi_id = coalesce(t.invoice_upi_id, c->>'invoice_upi_id'),
      invoice_bank_details = coalesce(t.invoice_bank_details, c->>'invoice_bank_details'),
      invoice_default_terms = coalesce(t.invoice_default_terms, c->>'invoice_default_terms'),
      invoice_default_notes = coalesce(t.invoice_default_notes, c->>'invoice_default_notes'),
      document_footer_note = coalesce(t.document_footer_note, c->>'document_footer_note'),
      plan_expiry = greatest(t.plan_expiry, (c->>'plan_expiry')::timestamptz)
     where t.id = p_target;
  end if;
  -- No plan limit while importing: company_plan() finds no plan without one.
  select plan into v_plan from public.companies where id = p_target;
  update public.companies set plan = null where id = p_target;

  -- People ---------------------------------------------------------------------
  for p in
    select distinct on (uid) *
      from (select r->>'firebase_uid' as uid, r, 'admin' as kind, 0 as pref from legacy.rows('admins', p_old) r
            union all
            select r->>'firebase_uid', r, 'employee', 1 from legacy.rows('employees', p_old) r) s
     order by uid, pref
  loop
    v_email := nullif(lower(btrim(p.r->>'email')), '');
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+$' then v_email := null; end if;
    v_login := v_email is not null and p.uid !~ '^(offline_|manual_emp_)';
    v_role := case when p.uid = v_owner and not p_merge then 'super_admin'
                   when p.kind = 'admin' or p.uid = v_owner then 'admin'
                   when (p.r->>'employee_type') = '2' then 'manager'
                   else 'employee' end;
    v_id := null;
    v_new := true;
    if v_login then
      v_ident := legacy.identity_for(v_email);
      select u.user_id into v_id
        from public.users u join auth.users a on a.id = u.user_id
       where u.company_id = p_target and (a.id = v_ident or a.identity_id = v_ident)
       limit 1;
      if v_id is not null then
        v_new := false;
      elsif not exists (select 1 from public.users where user_id = v_ident) then
        v_id := v_ident;
      else
        insert into auth.users (email, encrypted_password, email_verified, email_verified_at, identity_id)
        values (null, null, true, now(), v_ident) returning id into v_id;
      end if;
    else
      insert into auth.users (email, encrypted_password, email_verified) values (null, null, false)
      returning id into v_id;
    end if;
    if v_new then
      perform legacy.put('users', jsonb_build_object(
        'user_id', v_id, 'company_id', p_target, 'role', v_role,
        'name', coalesce(legacy.clip(p.r->>'name', 200), v_email, 'Team member'),
        'email', v_email, 'phone', p.r->'phone', 'alternate_phone', p.r->'alternate_phone',
        'status', coalesce(p.r->>'status', 'active'),
        'employee_type', case when v_role in ('employee') then 1 when v_role = 'manager' then 2 end,
        'salary', p.r->'salary', 'address', p.r->'address', 'engagement_type', p.r->'engagement_type',
        'deleted_at', p.r->'deleted_at', 'delete_reason', p.r->'delete_reason',
        'login_enabled', v_login, 'avatar_url', p.r->'photo',
        'created_at', p.r->'created_at', 'updated_at', p.r->'updated_at'));
    end if;
    insert into legacy.person values (p_old, p.uid, v_id) on conflict do nothing;
  end loop;
  if not p_merge then
    update public.companies set owner_user_id = legacy.uid(p_old, v_owner) where id = p_target;
  end if;

  -- Pay: the old compensation profile onto the person.
  for x in select r from legacy.rows('employee_compensation_profiles', p_old) r
            where legacy.uid(p_old, r->>'employee_firebase_uid') is not null
            order by r->>'updated_at'
  loop
    update public.users u set
      payout_type = case x->>'work_type' when 'freelancer' then 'per_day' when 'full_time' then 'salary'
                                          when 'intern' then 'salary' else 'custom' end,
      freelancer_rate = coalesce(u.freelancer_rate, nullif((x->>'day_rate')::numeric, 0)),
      salary = coalesce(u.salary, nullif((x->>'monthly_salary')::numeric, 0)),
      commission_pct = coalesce(u.commission_pct, nullif((x->>'commission_percent')::numeric, 0)),
      commission_basis = case when x->>'commission_basis' in ('revenue', 'payment', 'profit', 'manual') then x->>'commission_basis' end,
      payment_status = coalesce(nullif(x->>'compensation_status', ''), 'active'),
      pay_effective_from = (x->>'effective_from')::date,
      pay_effective_to = case when (x->>'effective_to')::date >= (x->>'effective_from')::date or x->>'effective_from' is null
                              then (x->>'effective_to')::date end,
      compensation_notes = legacy.clip(x->>'notes', 2000)
     where u.user_id = legacy.uid(p_old, x->>'employee_firebase_uid') and u.company_id = p_target;
  end loop;

  -- Job roles (the old app's shared roles are copied into each studio that used them).
  for x in
    select distinct on (er.r->>'id') er.r
      from legacy.src er
     where er.tbl = 'employee_roles'
       and (er.co = p_old::text
            or er.r->>'id' in (select a->>'role_id' from legacy.rows('employee_role_assignments', p_old) a))
  loop
    select id into v_id from public.employee_roles
     where company_id = p_target and role_code = x->>'role_code';
    if v_id is null then
      v_id := case when x->>'company_id' = p_old::text then (x->>'id')::uuid else gen_random_uuid() end;
      perform legacy.put('employee_roles', x || jsonb_build_object('id', v_id, 'company_id', p_target));
    end if;
    insert into legacy.idmap values (p_old, 'role', x->>'id', v_id) on conflict do nothing;
  end loop;
  insert into public.employee_role_assignments (user_id, role_id, company_id, created_at)
  select legacy.uid(p_old, r->>'firebase_uid'), legacy.mapped(p_old, 'role', r->>'role_id'), p_target,
         coalesce((r->>'assigned_at')::timestamptz, now())
    from legacy.rows('employee_role_assignments', p_old) r
   where legacy.uid(p_old, r->>'firebase_uid') is not null
  on conflict do nothing;

  for x in select r from legacy.rows('user_access_assignments', p_old) r where legacy.uid(p_old, r->>'user_uid') is not null loop
    perform legacy.put('user_access_assignments',
      (x - 'employee_id' - 'assigned_by_uid') || jsonb_build_object('company_id', p_target,
        'user_id', legacy.uid(p_old, x->>'user_uid'), 'created_at', x->'assigned_at'), true);
  end loop;
  for x in select r from legacy.rows('user_access_overrides', p_old) r where legacy.uid(p_old, r->>'user_uid') is not null loop
    perform legacy.put('user_access_overrides',
      x || jsonb_build_object('company_id', p_target, 'user_id', legacy.uid(p_old, x->>'user_uid')), true);
  end loop;

  -- Services (by name: a merged studio may already have the same one).
  for x in select r from legacy.rows('services', p_old) r loop
    select id into v_id from public.services where company_id = p_target and name = x->>'name';
    if v_id is null then
      perform legacy.put('services', x || jsonb_build_object('company_id', p_target));
    else
      insert into legacy.idmap values (p_old, 'service', x->>'id', v_id) on conflict do nothing;
    end if;
  end loop;

  -- Clients, projects, shoots ------------------------------------------------
  for x in select r from legacy.rows('clients', p_old) r loop
    perform legacy.put('clients', x || jsonb_build_object('company_id', p_target, 'relation', legacy.clip(x->>'relation', 60)));
  end loop;
  for x in select r from legacy.rows('projects', p_old) r loop
    perform legacy.put('projects', x || jsonb_build_object('company_id', p_target));
  end loop;
  for x in select r from legacy.rows('shoots', p_old) r loop
    perform legacy.put('shoots', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'project_id', x->'project_id',
      'name', coalesce(legacy.clip(x->>'title', 200), 'Shoot'),
      'shoot_date', to_jsonb(legacy.sane_date(x->>'date')),
      'notes', case when x->>'date' is not null and legacy.sane_date(x->>'date') is null
                    then to_jsonb('Date in the old app: ' || (x->>'date')) end,
      'start_at', case when legacy.sane_date(x->>'date') is not null and x->>'time' is not null
                       then to_jsonb(((x->>'date') || ' ' || (x->>'time'))::timestamp at time zone 'Asia/Kolkata') end,
      'location', x->'city', 'map_link', x->'venue_url',
      'created_at', x->'created_at', 'updated_at', x->'updated_at'));
  end loop;
  insert into public.shoot_assignments (company_id, shoot_id, user_id, created_at)
  select p_target, (s.r->>'shoot_id')::uuid, legacy.uid(p_old, s.r->>'employee_firebase_uid'), (s.r->>'created_at')::timestamptz
    from legacy.rows('shoot_assignments', p_old) s(r)
   where exists (select 1 from public.shoots sh where sh.id = (s.r->>'shoot_id')::uuid and sh.company_id = p_target)
     and legacy.uid(p_old, s.r->>'employee_firebase_uid') is not null;
  insert into public.shoot_services (company_id, shoot_id, service_id, quantity)
  select p_target, (s.r->>'shoot_id')::uuid, legacy.mapped(p_old, 'service', s.r->>'service_id'),
         greatest(coalesce((s.r->>'quantity')::int, 1), 1)
    from legacy.rows('shoot_services', p_old) s(r)
   where exists (select 1 from public.shoots sh where sh.id = (s.r->>'shoot_id')::uuid and sh.company_id = p_target)
     and exists (select 1 from public.services sv where sv.id = legacy.mapped(p_old, 'service', s.r->>'service_id'));

  -- Deliverables: the old app's two lists are one table here (list_key).
  for x in select s.r || jsonb_build_object('list_key', case s.tbl when 'deliverables' then 'primary' else 'secondary' end)
             from legacy.src s
            where s.tbl in ('deliverables', 'deliverables_2') and s.co = p_old::text loop
    perform legacy.put('deliverables', x || jsonb_build_object('company_id', p_target,
      'shoot_id', case when exists (select 1 from public.shoots where id = (x->>'shoot_id')::uuid) then x->'shoot_id' end,
      'start_rule', case when x->>'start_rule' in ('this_shoot', 'whole_project', 'specific_shoots', 'no_data') then x->'start_rule' end,
      'estimated_date', to_jsonb(legacy.sane_date(x->>'estimated_date')),
      'custom_status_code', case when exists (select 1 from public.company_deliverable_statuses cs
                                               where cs.company_id = p_target and cs.code = x->>'custom_status_code'
                                                 and cs.stage = x->>'status') then x->'custom_status_code' end));
  end loop;
  -- Several shoots for one deliverable: only then does the link table hold them (0227).
  insert into public.deliverable_shoot_links (company_id, deliverable_id, shoot_id)
  select distinct p_target, (r->>'deliverable_id')::uuid, (r->>'shoot_id')::uuid
    from legacy.rows('deliverable_shoot_links', p_old) r
   where r->>'deliverable_id' in (select r->>'deliverable_id' from legacy.rows('deliverable_shoot_links', p_old) r
                                   group by 1 having count(distinct r->>'shoot_id') > 1)
     and exists (select 1 from public.deliverables d where d.id = (r->>'deliverable_id')::uuid and d.company_id = p_target)
     and exists (select 1 from public.shoots s where s.id = (r->>'shoot_id')::uuid and s.company_id = p_target)
  on conflict do nothing;

  -- Tasks (parents first, then the links between them).
  for x in select r from legacy.rows('tasks', p_old) r loop
    perform legacy.put('tasks', (x - 'parent_task_id' - 'deliverable_2_id') || jsonb_build_object(
      'company_id', p_target,
      'deliverable_id', coalesce(x->'deliverable_id', x->'deliverable_2_id'),
      'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end));
  end loop;
  update public.tasks t set parent_task_id = (s.r->>'parent_task_id')::uuid
    from legacy.rows('tasks', p_old) s(r)
   where t.id = (s.r->>'id')::uuid and s.r->>'parent_task_id' is not null
     and exists (select 1 from public.tasks pt where pt.id = (s.r->>'parent_task_id')::uuid);
  insert into public.task_assignees (task_id, user_id, company_id, created_at)
  select (s.r->>'task_id')::uuid, legacy.uid(p_old, s.r->>'employee_firebase_uid'), p_target,
         coalesce((s.r->>'created_at')::timestamptz, now())
    from legacy.rows('task_assignees', p_old) s(r)
   where exists (select 1 from public.tasks t where t.id = (s.r->>'task_id')::uuid and t.company_id = p_target)
     and legacy.uid(p_old, s.r->>'employee_firebase_uid') is not null
  on conflict do nothing;

  -- Crew bookings: a second booking that overlaps the person's first is kept
  -- as released, with a note -- the database refuses two at once.
  for x in select r from legacy.rows('team_assignment_slots', p_old) r
            where legacy.uid(p_old, r->>'member_uid') is not null
            order by (r->>'status') = 'booked' desc, r->>'created_at' loop
    x := (x - 'member_uid' - 'cancelled_at' - 'data_not_required_at' - 'data_not_required_by_uid')
         || jsonb_build_object('company_id', p_target, 'user_id', legacy.uid(p_old, x->>'member_uid'),
              'shoot_id', case when exists (select 1 from public.shoots where id = (x->>'shoot_id')::uuid) then x->'shoot_id' end,
              'end_at', case when (x->>'end_at')::timestamptz > (x->>'start_at')::timestamptz then x->'end_at'
                             else to_jsonb((x->>'start_at')::timestamptz + interval '1 hour') end);
    begin
      perform legacy.put('team_assignment_slots', x);
    exception when others then
      perform legacy.put('team_assignment_slots', x || jsonb_build_object(
        'status', 'released', 'released_at', coalesce(x->'released_at', x->'created_at'),
        'cost_notes', legacy.clip(coalesce(x->>'cost_notes' || ' · ', '') || 'Released when moved to the new app: overlapped another booking', 500)));
    end;
  end loop;

  -- Data and disks -------------------------------------------------------------
  for x in select r from legacy.rows('storage_locations', p_old) r loop
    select id into v_id from public.storage_locations where company_id = p_target and name = x->>'name';
    if v_id is null then
      perform legacy.put('storage_locations', jsonb_build_object(
        'id', x->'id', 'company_id', p_target, 'name', x->'name',
        'kind', case x->>'type' when 'nas' then 'nas' when 'cloud_drive' then 'cloud' when 'other' then 'other' else 'drive' end,
        'location_type', x->'type', 'capacity_gb', to_jsonb(legacy.gb(x->>'capacity')), 'owner', x->'owner_or_holder',
        'notes', x->'notes', 'is_active', x->'is_active', 'created_at', x->'created_at'));
    else
      insert into legacy.idmap values (p_old, 'disk', x->>'id', v_id) on conflict do nothing;
    end if;
  end loop;
  for x in select r from legacy.rows('data_people', p_old) r loop
    perform legacy.put('data_people', (x - 'email' - 'notes') || jsonb_build_object('company_id', p_target));
  end loop;
  for x in select r from legacy.rows('shoot_data_records', p_old) r loop
    perform legacy.put('shoot_data_records',
      (x - 'team_member_uid' - 'primary_location_name' - 'backup_location_name' - 'created_by_uid' - 'updated_by_uid'
         - 'verified_by_uid' - 'copied_by_role' - 'copied_at' - 'copied_by_uid' - 'received_by_uid')
      || jsonb_build_object(
        'company_id', p_target,
        'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end,
        'shoot_id', case when exists (select 1 from public.shoots where id = (x->>'shoot_id')::uuid) then x->'shoot_id' end,
        'data_label', coalesce(legacy.clip(x->>'data_label', 200), legacy.clip(x->>'requirement_name', 200), 'Data'),
        'user_id', legacy.uid(p_old, x->>'team_member_uid'),
        'copied_by_uid', legacy.uid(p_old, x->>'copied_by_uid'),
        'received_by_uid', legacy.uid(p_old, x->>'received_by_uid'),
        'verified_by', legacy.uid(p_old, x->>'verified_by_uid'),
        'primary_location_id', legacy.mapped(p_old, 'disk', x->>'primary_location_id'),
        'backup_location_id', legacy.mapped(p_old, 'disk', x->>'backup_location_id'),
        'copied_by_person_id', case when exists (select 1 from public.data_people where id = (x->>'copied_by_person_id')::uuid) then x->'copied_by_person_id' end,
        -- The old app let a copy be marked done without saying where; here it must say.
        'folder_path', to_jsonb(coalesce(nullif(btrim(x->>'folder_path'), ''), nullif(btrim(x->>'primary_location_name'), ''),
                                         case when x->>'primary_status' in ('primary_done', 'verified')
                                               and legacy.mapped(p_old, 'disk', x->>'primary_location_id') is null
                                               and nullif(btrim(x->>'cloud_link'), '') is null
                                              then 'Not recorded in the old app' end)),
        'backup_folder_path', to_jsonb(coalesce(nullif(btrim(x->>'backup_folder_path'), ''), nullif(btrim(x->>'backup_location_name'), ''),
                                         case when x->>'backup_status' in ('backup_done', 'verified')
                                               and legacy.mapped(p_old, 'disk', x->>'backup_location_id') is null
                                               and nullif(btrim(x->>'backup_cloud_link'), '') is null
                                              then 'Not recorded in the old app' end)),
        'primary_status', case x->>'primary_status' when 'primary_done' then 'copied' when 'verified' then 'verified' else 'pending' end,
        'backup_status', case x->>'backup_status' when 'backup_done' then 'copied' when 'verified' then 'verified' else 'pending' end,
        'data_status', case lower(x->>'data_status')
                         when 'received' then 'received' when 'recived' then 'received'
                         when 'copied' then 'copied' when 'backup_done' then 'backed_up'
                         when 'ready_for_edit' then 'verified' when 'completed' then 'verified'
                         else 'with_shooter' end));
  end loop;

  -- Money ------------------------------------------------------------------------
  for x in select r from legacy.rows('invoices', p_old) r loop
    v_num := x->>'invoice_number';
    if exists (select 1 from public.invoices where company_id = p_target and invoice_number = v_num) then
      v_num := v_num || '-OLD';
    end if;
    perform legacy.put('invoices', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'client_id', x->'client_id', 'project_id', x->'project_id',
      'invoice_number', v_num, 'invoice_date', x->'invoice_date', 'due_date', x->'due_date',
      'place_of_supply', case when exists (select 1 from public.state_master where code = x->>'place_of_supply') then x->'place_of_supply' end,
      'status', case x->>'status' when 'partially_paid' then 'partial' when 'overdue' then 'sent'
                                  when 'paid' then 'paid' when 'cancelled' then 'cancelled' when 'draft' then 'draft' else 'sent' end,
      'subtotal', x->'subtotal', 'discount', x->'discount_value',
      'discount_type', case when x->>'discount_type' in ('flat', 'percent') then x->>'discount_type' else 'flat' end,
      'taxable', coalesce((x->>'subtotal')::numeric, 0) - coalesce((x->>'discount_value')::numeric, 0),
      'tax', x->'tax_total', 'total', x->'total_amount', 'amount_paid', x->'amount_paid', 'balance_due', x->'balance_due',
      'intra_state', coalesce(x->>'tax_type', '') <> 'igst',
      'notes', x->'notes', 'terms', x->'terms', 'bank_details', x->'bank_details', 'gst_number', x->'gst_number',
      'created_at', x->'created_at', 'updated_at', x->'updated_at'));
  end loop;
  for x in select i.r || jsonb_build_object('_tax_type', inv->>'tax_type')
             from legacy.rows('invoice_items', p_old) i(r) join legacy.rows('invoices', p_old) inv on inv->>'id' = i.r->>'invoice_id' loop
    perform legacy.put('invoice_items', jsonb_build_object(
      'id', x->'id', 'invoice_id', x->'invoice_id', 'company_id', p_target,
      'description', coalesce(legacy.clip(x->>'title', 500), legacy.clip(x->>'description', 500), 'Item'),
      'subtext', case when x->>'title' is not null then x->'description' end,
      'quantity', x->'quantity', 'rate', x->'rate', 'amount', x->'amount', 'taxable', x->'amount',
      'gst_rate', x->'tax_rate', 'sort_order', x->'sort_order',
      'cgst', case when x->>'_tax_type' = 'cgst_sgst' then coalesce((x->>'tax_amount')::numeric, 0) / 2 else 0 end,
      'sgst', case when x->>'_tax_type' = 'cgst_sgst' then coalesce((x->>'tax_amount')::numeric, 0) / 2 else 0 end,
      'igst', case when x->>'_tax_type' = 'igst' then coalesce((x->>'tax_amount')::numeric, 0) else 0 end));
  end loop;
  for x in select r from legacy.rows('received_payments', p_old) r loop
    perform legacy.put('received_payments', (x - 'type' - 'updated_at') || jsonb_build_object(
      'company_id', p_target,
      'paid_on', to_jsonb(coalesce((x->>'date_received')::date, (x->>'created_at')::date)),
      'date_received', to_jsonb((x->>'date_received')::date),
      'status', case when x->>'status' = 'pending' then 'pending' else 'paid' end,
      'invoice_id', (select ip.r->'invoice_id' from legacy.rows('invoice_payments', p_old) ip(r)
                      where ip.r->>'received_payment_id' = x->>'id' limit 1)));
  end loop;
  -- A payment the old app took on an invoice alone is a payment here too.
  for x in select ip.r || jsonb_build_object('_project', inv->'project_id', '_client', inv->'client_id')
             from legacy.rows('invoice_payments', p_old) ip(r)
             join legacy.rows('invoices', p_old) inv on inv->>'id' = ip.r->>'invoice_id'
            where ip.r->>'received_payment_id' is null loop
    perform legacy.put('received_payments', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'invoice_id', x->'invoice_id', 'project_id', x->'_project',
      'client_id', x->'_client', 'amount', x->'amount', 'paid_on', x->'payment_date', 'date_received', x->'payment_date',
      'mode', x->'payment_mode', 'reference', to_jsonb(nullif(x->>'transaction_reference', '')),
      'notes', to_jsonb(nullif(x->>'notes', '')), 'status', 'paid', 'created_at', x->'created_at'));
  end loop;
  for x in select r from legacy.rows('expense_categories', p_old) r loop
    insert into public.expense_categories (id, company_id, name, created_at)
    values ((x->>'id')::uuid, p_target, x->>'name', (x->>'created_at')::timestamptz)
    on conflict do nothing;
  end loop;
  for x in select r from legacy.rows('expenses', p_old) r loop
    perform legacy.put('expenses', x || jsonb_build_object('company_id', p_target,
      'allocation_method', case when x->>'allocation_method' in ('equal', 'revenue_weighted', 'shoot_days_weighted') then x->'allocation_method' end,
      'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end));
  end loop;
  for x in select r from legacy.rows('monthly_salaries', p_old) r where legacy.uid(p_old, r->>'employee_uid') is not null loop
    perform legacy.put('monthly_salaries', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'user_id', legacy.uid(p_old, x->>'employee_uid'),
      'month', make_date((x->>'year')::int, (x->>'month')::int, 1),
      'pay_month', x->'month', 'pay_year', x->'year', 'base_amount', x->'base_salary',
      'gross', x->'base_salary', 'net', x->'base_salary', 'paid_amount', x->'paid_amount',
      'status', x->'status', 'created_at', x->'created_at', 'generated_at', x->'created_at'), true);
  end loop;

  -- Attendance: check-ins always; the old app's automatic "absent" marks only
  -- for a studio that really used attendance (it marked everyone else too).
  select exists (select 1 from legacy.rows('attendance', p_old) r where r->>'a_status' = '1') into v_used_att;
  insert into public.attendance (company_id, user_id, a_date, check_in_at, check_out_at, status, source, late_minutes, created_at)
  select p_target, pe.user_id, (s.r->>'a_date')::date, (s.r->>'in_time')::timestamptz, (s.r->>'out_time')::timestamptz,
         case when s.r->>'a_status' = '1' then case when (s.r->>'is_late')::boolean then 'late' else 'present' end else 'absent' end,
         case when s.r->>'source' = 'auto_login' then 'auto_login' else 'manual' end,
         greatest(coalesce((s.r->>'late_minutes')::int, 0), 0),
         coalesce((s.r->>'created_at')::timestamptz, now())
    from legacy.rows('attendance', p_old) s(r)
    join legacy.person pe on pe.old_company = p_old and pe.old_uid = s.r->>'firebase_uid'
   where s.r->>'a_status' = '1' or v_used_att
  on conflict do nothing;
  for x in select r from legacy.rows('company_location', p_old) r loop
    if not exists (select 1 from public.attendance_places where company_id = p_target) then
      insert into public.attendance_places (company_id, name, lat, lng, radius_m, is_active, is_primary, created_at)
      values (p_target, 'Studio', (x->>'latitude')::float8, (x->>'longitude')::float8,
              least(greatest(coalesce((x->>'radius_meters')::int, 150), 20), 5000),
              coalesce((x->>'is_active')::boolean, true), true, (x->>'created_at')::timestamptz);
    end if;
    -- The hours come across; switching attendance on stays the owner's choice (0224).
    insert into public.attendance_policy (company_id, enabled, day_start, grace_min)
    values (p_target, false, (x->>'expected_checkin_time')::time,
            least(greatest(coalesce((x->>'late_grace_minutes')::int, 15), 0), 240))
    on conflict (company_id) do nothing;
  end loop;

  -- CRM ----------------------------------------------------------------------
  select id into v_pipeline from public.crm_pipelines where company_id = p_target order by is_default desc, position limit 1;
  -- The old app's in-between stages become this studio's own stages.
  insert into public.crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind, probability_default, color)
  select v_pipeline, p_target, s.name, s.key, s.pos, 'open', s.prob, s.color
    from (values ('follow_up_needed', 'Follow-up needed', 1, 25::smallint, 'amber'),
                 ('call_scheduled', 'Call scheduled', 1, 30::smallint, 'teal'),
                 ('negotiation', 'Negotiation', 3, 80::smallint, 'violet')) s(key, name, pos, prob, color)
   where v_pipeline is not null
     and exists (select 1 from legacy.rows('crm_leads', p_old) l where l->>'stage' = s.key)
  on conflict do nothing;
  for x in select r from legacy.rows('crm_leads', p_old) r loop
    perform legacy.put('crm_leads', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'name', x->'name', 'phone', x->'phone',
      'alternate_phone', to_jsonb(legacy.clip(x->>'alt_phone', 30)), 'email', x->'email',
      'city', to_jsonb(legacy.clip(x->>'city', 120)), 'event_type', to_jsonb(legacy.clip(x->>'event_type', 80)),
      'event_date', x->'event_date', 'event_location', to_jsonb(legacy.clip(x->>'event_location', 200)),
      'deal_value', case when (x->>'estimated_budget')::numeric >= 0 then x->'estimated_budget' end,
      'source', to_jsonb(coalesce(legacy.clip(x->>'source', 40), 'manual')),
      'group_name', to_jsonb(legacy.clip(x->>'group_name', 120)),
      'quality', to_jsonb(legacy.clip(x->>'quality', 40)),
      'contacted_status', case when x->>'contacted_status' in ('uncontacted', 'contacted', 'unreachable') then x->'contacted_status' end,
      'follow_up_at', x->'follow_up_at', 'notes', x->'notes',
      'assigned_to', legacy.uid(p_old, x->>'assigned_to_firebase_uid'),
      'status', case x->>'stage' when 'won' then 'converted' when 'lost' then 'lost'
                                 when 'proposal_sent' then 'proposal_sent' when 'negotiation' then 'proposal_sent'
                                 when 'new_lead' then 'new' else 'contacted' end,
      'lost_reason', case when x->>'stage' = 'lost'
                          then to_jsonb(coalesce(case when length(btrim(x->>'lost_reason')) >= 3 then legacy.clip(x->>'lost_reason', 500) end,
                                                 'Not recorded in the old app')) end,
      'pipeline_id', v_pipeline,
      'stage_id', (select id from public.crm_pipeline_stages
                    where pipeline_id = v_pipeline
                      and key = case x->>'stage' when 'new_lead' then 'new' when 'won' then 'converted' else x->>'stage' end),
      'converted_client_id', case when exists (select 1 from public.clients where id = (x->>'client_id')::uuid) then x->'client_id' end,
      'converted_project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end,
      'converted_at', case when x->>'stage' = 'won' then x->'updated_at' end,
      'is_archived', x->>'status' = 'archived',
      'archived_at', case when x->>'status' = 'archived' then x->'updated_at' end,
      'archive_reason', case when x->>'status' = 'archived' then '"Archived in the old app"'::jsonb end,
      'created_via', 'import',
      'created_at', x->'created_at', 'updated_at', x->'updated_at'));
  end loop;
  for x in select r from legacy.rows('crm_lead_activities', p_old) r
            where exists (select 1 from public.crm_leads l where l.id = (r->>'lead_id')::uuid) loop
    perform legacy.put('crm_activities', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'lead_id', x->'lead_id',
      'type', case x->>'activity_type' when 'call_done' then 'call' when 'whatsapp_opened' then 'whatsapp'
                                      when 'message_sent' then 'whatsapp' else 'note' end,
      'subject', to_jsonb(legacy.clip(x->>'title', 200)), 'body', to_jsonb(legacy.clip(x->>'description', 8000)),
      'actor_id', legacy.uid(p_old, x->>'created_by_firebase_uid'),
      'done_at', x->'created_at', 'meta', jsonb_build_object('legacy_type', x->'activity_type'),
      'created_at', x->'created_at'));
  end loop;
  -- The old app's enquiries and simple leads are leads here (0168).
  for x in select r || jsonb_build_object('_kind', 'enquiry') from legacy.rows('enquiries', p_old) r
           union all
           select r || jsonb_build_object('_kind', 'lead') from legacy.rows('leads', p_old) r loop
    perform legacy.put('crm_leads', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'name', x->'name', 'phone', x->'phone', 'email', x->'email',
      'source', to_jsonb(coalesce(legacy.clip(x->>'source', 40), case x->>'_kind' when 'enquiry' then 'enquiry' else 'manual' end)),
      'notes', to_jsonb(coalesce(x->>'message', x->>'notes')),
      'status', 'new', 'pipeline_id', v_pipeline,
      'stage_id', (select id from public.crm_pipeline_stages where pipeline_id = v_pipeline and key = 'new'),
      'created_via', 'import', 'created_at', x->'created_at', 'updated_at', x->'updated_at'));
  end loop;

  -- Referrals: public slugs are unique across every studio.
  for x in select r from legacy.rows('client_referral_campaigns', p_old) r loop
    v_slug := x->>'public_slug';
    if v_slug is null or exists (select 1 from public.referral_campaigns where slug = v_slug) then
      v_slug := coalesce(v_slug, 'ref') || '-' || substr(md5(x->>'id'), 1, 6);
    end if;
    perform legacy.put('referral_campaigns', jsonb_build_object(
      'id', x->'id', 'company_id', p_target,
      'name', coalesce(legacy.clip(x->>'client_name', 120) || '''s referrals', legacy.clip(x->>'reward_title', 160), 'Referrals'),
      'slug', v_slug, 'reward_type', coalesce(x->>'reward_type', 'custom'),
      'reward_title', to_jsonb(legacy.clip(x->>'reward_title', 160)), 'reward_description', x->'reward_description',
      'status', case when x->>'status' in ('active', 'paused', 'ended', 'archived') then x->'status' end,
      'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end,
      'client_id', case when exists (select 1 from public.clients where id = (x->>'client_id')::uuid) then x->'client_id' end,
      'created_by', legacy.uid(p_old, x->>'created_by_firebase_uid'),
      'archived_at', x->'archived_at', 'created_at', x->'created_at', 'updated_at', x->'updated_at'));
  end loop;
  for x in select r from legacy.rows('client_referral_submissions', p_old) r
            where exists (select 1 from public.referral_campaigns c where c.id = (r->>'campaign_id')::uuid) loop
    perform legacy.put('referral_submissions', (x - 'referring_client_id' - 'referred_phone_normalized' - 'referred_email_normalized')
      || jsonb_build_object('company_id', p_target,
           'client_name', coalesce(legacy.clip(x->>'referred_name', 160), 'Referral'),
           'client_phone', x->'referred_phone', 'client_email', x->'referred_email',
           'referred_name', to_jsonb(legacy.clip(x->>'referred_name', 160)),
           'referring_client_name', to_jsonb(legacy.clip(x->>'referring_client_name', 160)),
           'source', to_jsonb(coalesce(legacy.clip(x->>'source', 40), 'referral_link')),
           'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end,
           'crm_lead_id', case when exists (select 1 from public.crm_leads where id = (x->>'crm_lead_id')::uuid) then x->'crm_lead_id' end,
           'linked_lead_id', case when exists (select 1 from public.crm_leads where id = (x->>'crm_lead_id')::uuid) then x->'crm_lead_id' end,
           'functions_count', case when (x->>'functions_count')::int between 0 and 20 then x->'functions_count' end));
  end loop;
  for x in select r from legacy.rows('reminders', p_old) r loop
    v_id := coalesce(legacy.uid(p_old, x->>'assigned_to'), legacy.uid(p_old, x->>'created_by'), legacy.uid(p_old, v_owner),
                     (select owner_user_id from public.companies where id = p_target));
    continue when v_id is null;
    perform legacy.put('reminders', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'user_id', v_id,
      'entity_type', case when x->>'entity_type' in ('lead', 'project', 'client', 'invoice', 'custom', 'enquiry', 'task', 'shoot', 'general', 'deliverable')
                          then x->'entity_type' end,
      'entity_id', x->'entity_id', 'title', coalesce(legacy.clip(x->>'title', 300), 'Reminder'),
      'description', x->'note',
      'priority', case when x->>'priority' in ('low', 'medium', 'high', 'urgent') then x->'priority' end,
      'status', case x->>'status' when 'completed' then 'completed' when 'dismissed' then 'dismissed' else 'active' end,
      'due_at', x->'due_at', 'created_by', legacy.uid(p_old, x->>'created_by'),
      'created_at', x->'created_at', 'updated_at', x->'updated_at'));
  end loop;

  -- Terms --------------------------------------------------------------------
  for x in select r from legacy.rows('project_terms_templates', p_old) r where not coalesce((r->>'is_system')::boolean, false) loop
    perform legacy.put('project_terms_templates', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'name', coalesce(x->>'name', 'Terms'),
      'body', coalesce(legacy.sections_text(legacy.as_json(x->'content_json')->'sections'), x->>'html_template', x->>'name', 'Terms'),
      'created_at', x->'created_at'));
  end loop;
  -- One draft per project here: an older second draft comes over as issued.
  for x in select r || jsonb_build_object('_draft_rank',
                     row_number() over (partition by r->>'project_id', (r->>'status') = 'draft' order by r->>'updated_at' desc))
             from legacy.rows('project_terms_documents', p_old) r loop
    perform legacy.put('project_terms_documents', jsonb_build_object(
      'id', x->'id', 'company_id', p_target,
      'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end,
      'template_id', case when exists (select 1 from public.project_terms_templates where id = (x->>'template_id')::uuid) then x->'template_id' end,
      'title', x->'title',
      'sections', coalesce(legacy.as_json(x->'content_json')->'sections', '[]'::jsonb),
      'legal_note', legacy.as_json(x->'content_json')->'meta'->'legal_note',
      'payment_terms', coalesce(legacy.as_json(x->'payment_terms_json'), '[]'::jsonb),
      'rendered_body', coalesce(x->>'html_snapshot', legacy.sections_text(legacy.as_json(x->'content_json')->'sections'), x->>'title', 'Terms'),
      'is_draft', x->>'status' = 'draft' and (x->>'_draft_rank')::int = 1,
      'sent_at', x->'sent_at', 'revoked_at', case when x->>'status' = 'revoked' then x->'updated_at' end,
      'acknowledged_at', x->'acknowledged_at', 'acknowledged_by_name', x->'acknowledged_by_name',
      'acknowledged_by_email', x->'acknowledged_by_email', 'acknowledged_ip', x->'acknowledged_ip',
      'acknowledged_user_agent', x->'acknowledged_user_agent', 'created_at', x->'created_at'));
  end loop;
  for x in select r from legacy.rows('quotation_term_presets', p_old) r where r->>'archived_at' is null loop
    perform legacy.put('quotation_terms_presets', (x - 'created_by_firebase_uid' - 'archived_at')
      || jsonb_build_object('company_id', p_target, 'is_default', false));
  end loop;
  for x in select r from legacy.rows('team_terms_templates', p_old) r loop
    perform legacy.put('team_terms_templates', (x - 'created_by_firebase_uid')
      || jsonb_build_object('company_id', p_target, 'body', coalesce(x->>'body', x->>'title', 'Terms')));
  end loop;
  insert into public.team_terms_template_roles (template_id, role_id, company_id)
  select distinct (s.r->>'template_id')::uuid, legacy.mapped(p_old, 'role', s.r->>'role_id'), p_target
    from legacy.rows('team_terms_template_roles', p_old) s(r)
   where exists (select 1 from public.team_terms_templates t where t.id = (s.r->>'template_id')::uuid and t.company_id = p_target)
     and exists (select 1 from public.employee_roles er where er.id = legacy.mapped(p_old, 'role', s.r->>'role_id'))
  on conflict do nothing;
  for x in select r from legacy.rows('team_terms_sends', p_old) r loop
    perform legacy.put('team_terms_sends',
      (x - 'employee_firebase_uid' - 'created_by_firebase_uid' - 'recipient_identity_key' - 'recipient_email_normalized' - 'recipient_phone_normalized')
      || jsonb_build_object('company_id', p_target, 'user_id', legacy.uid(p_old, x->>'employee_firebase_uid'),
           'role_id', case when exists (select 1 from public.employee_roles where id = legacy.mapped(p_old, 'role', x->>'role_id'))
                           then to_jsonb(legacy.mapped(p_old, 'role', x->>'role_id')) end,
           'template_id', case when exists (select 1 from public.team_terms_templates where id = (x->>'template_id')::uuid) then x->'template_id' end,
           'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end,
           'shoot_id', case when exists (select 1 from public.shoots where id = (x->>'shoot_id')::uuid) then x->'shoot_id' end,
           'recipient_name', coalesce(x->>'recipient_name', 'Team member'),
           'rendered_body', coalesce((select body from public.team_terms_templates where id = (x->>'template_id')::uuid), 'Team terms')));
  end loop;

  -- Templates and work ----------------------------------------------------------
  for x in select r from legacy.rows('deliverable_templates', p_old) r loop
    perform legacy.put('deliverable_templates', jsonb_build_object(
      'id', x->'id', 'company_id', p_target, 'title', x->'title', 'shoot_type', x->'shoot_type',
      'delivery_days', x->'default_delivery_days', 'due_basis', x->'due_basis', 'brief', x->'default_brief',
      'is_combined', coalesce((x->>'is_combined_default')::boolean, false),
      'usage_count', coalesce((x->>'usage_count')::int, 0),
      'is_archived', not coalesce((x->>'is_active')::boolean, true), 'created_at', x->'created_at'), true);
  end loop;
  for x in select r from legacy.rows('task_bundles', p_old) r loop
    perform legacy.put('task_bundles', jsonb_build_object('id', x->'id', 'company_id', p_target, 'name', x->'name', 'created_at', x->'created_at'));
  end loop;
  insert into public.task_bundle_items (id, bundle_id, company_id, title, priority, sort_order)
  select (i.r->>'id')::uuid, (i.r->>'bundle_id')::uuid, p_target, coalesce(i.r->>'title', 'Task'),
         coalesce(nullif(i.r->>'priority', ''), 'medium')::task_priority, coalesce((i.r->>'position')::int, 0)
    from legacy.rows('task_bundle_items', p_old) i(r)
   where exists (select 1 from public.task_bundles b where b.id = (i.r->>'bundle_id')::uuid and b.company_id = p_target);
  for x in select r from legacy.rows('team_work_submissions', p_old) r loop
    perform legacy.put('team_work_submissions', jsonb_build_object(
      'id', x->'id', 'company_id', p_target,
      'project_id', case when exists (select 1 from public.projects where id = (x->>'project_id')::uuid) then x->'project_id' end,
      'task_id', case when exists (select 1 from public.tasks where id = (x->>'task_id')::uuid) then x->'task_id' end,
      'deliverable_id', case when exists (select 1 from public.deliverables where id = (x->>'deliverable_id')::uuid) then x->'deliverable_id' end,
      'submitted_by', legacy.uid(p_old, x->>'employee_uid'),
      'title', x->'title', 'work_type', x->'work_type', 'method', x->'submission_method',
      'submission_link', x->'link_url', 'storage_ref', x->'storage_type',
      'disk_name', x->'hard_disk_name', 'disk_location', x->'hard_disk_location', 'folder_path', x->'folder_path',
      'notes', x->'notes', 'review_required', coalesce((x->>'review_required')::boolean, true),
      'status', case x->>'status' when 'approved' then 'approved' when 'sent_to_client' then 'sent'
                                  when 'revision_required' then 'rejected' else 'submitted' end,
      'review_notes', x->'reviewer_notes', 'reviewed_by', legacy.uid(p_old, x->>'reviewed_by_uid'),
      'reviewed_at', x->'reviewed_at', 'client_sent_at', x->'client_sent_at',
      'created_at', coalesce(x->'submitted_at', x->'created_at'), 'updated_at', x->'updated_at'));
  end loop;

  -- Look and logo ---------------------------------------------------------------
  if not p_merge then
    for x in select r from legacy.rows('company_theme_settings', p_old) r loop
      perform legacy.put('company_theme_settings', (x - 'id' - 'font_family' - 'button_radius' - 'card_radius' - 'is_custom_theme_enabled' - 'created_at')
        || jsonb_build_object('company_id', p_target, 'is_custom_theme', coalesce((x->>'is_custom_theme_enabled')::boolean, false)), true);
    end loop;
  end if;
  for x in select jsonb_build_object('col', k, 'url', c->>k) from unnest(array['avatar_url', 'invoice_logo_url']) k
            where c->>k like '%/storage/v1/object/public/company-branding/%' loop
    select id into v_id from public.files f
     where f.company_id = p_target and f.name = split_part(x->>'url', '/company-branding/', 2);
    if v_id is null then
      insert into public.files (company_id, name, mime, size_bytes, bytes, is_public)
      select p_target, b.path, b.mime, length(decode(b.b64, 'base64')), decode(b.b64, 'base64'), true
        from legacy.blobs b
       where b.bucket = 'company-branding' and b.path = split_part(split_part(x->>'url', '/company-branding/', 2), '?', 1)
      returning id into v_id;
    end if;
    continue when v_id is null;
    execute format('update public.companies set %I = coalesce(case when $3 then %I end, $1) where id = $2', x->>'col', x->>'col')
      using legacy.api_origin() || '/public/files/' || v_id, p_target, p_merge;
  end loop;

  -- Leave no trace of the import itself: no bell and no message for any of it,
  -- and the plan as it was. A trigger's row carries this transaction's now();
  -- anything the live app wrote meanwhile carries its own, so it stays.
  delete from public.notifications where company_id = p_target and created_at = now();
  delete from public.message_outbox where company_id = p_target and created_at = now();
  update public.companies set plan = v_plan where id = p_target;

  select jsonb_object_agg(t, n) into v_counts from (
    select 'clients' t, count(*) n from public.clients where company_id = p_target
    union all select 'projects', count(*) from public.projects where company_id = p_target
    union all select 'shoots', count(*) from public.shoots where company_id = p_target
    union all select 'deliverables', count(*) from public.deliverables where company_id = p_target
    union all select 'tasks', count(*) from public.tasks where company_id = p_target
    union all select 'people', count(*) from public.users where company_id = p_target
    union all select 'crew_bookings', count(*) from public.team_assignment_slots where company_id = p_target
    union all select 'invoices', count(*) from public.invoices where company_id = p_target
    union all select 'payments', count(*) from public.received_payments where company_id = p_target
    union all select 'expenses', count(*) from public.expenses where company_id = p_target
    union all select 'leads', count(*) from public.crm_leads where company_id = p_target
    union all select 'attendance', count(*) from public.attendance where company_id = p_target) q;
  return v_counts;
end $$;

-- ---------------------------------------------------------------------------
-- Every studio. Re-runnable: a studio already imported or merged is skipped,
-- a failed one is tried again.
-- ---------------------------------------------------------------------------
create or replace function legacy.import_all(p_only uuid default null)
returns jsonb language plpgsql as $$
declare
  s        record;
  v_target uuid;
  v_merge  boolean;
  v_counts jsonb;
  v_err    text;
  v_done   jsonb := '{"imported":0,"merged":0,"skipped_empty":0,"failed":0}'::jsonb;
begin
  for s in
    select (r->>'id')::uuid as old_id, coalesce(nullif(btrim(r->>'name'), ''), 'Studio') as name, r->>'created_at' as created_at
      from legacy.src
     where tbl = 'companies' and (p_only is null or r->>'id' = p_only::text)
       and coalesce(r->>'plan', '') <> 'e2e_test'
       and not exists (select 1 from public.legacy_imports li
                        where li.old_company_id = (r->>'id')::uuid and li.status in ('imported', 'merged', 'skipped_empty'))
     order by r->>'created_at'
  loop
    if not legacy.has_data(s.old_id) then
      insert into public.legacy_imports (old_company_id, studio_name, status, detail)
      values (s.old_id, s.name, 'skipped_empty',
              jsonb_build_object('admins', (select jsonb_agg(lower(btrim(r->>'email'))) from legacy.rows('admins', s.old_id) r),
                                 'created_at', s.created_at))
      on conflict (old_company_id) do update set status = excluded.status, detail = excluded.detail, imported_at = now();
      v_done := jsonb_set(v_done, '{skipped_empty}', to_jsonb((v_done->>'skipped_empty')::int + 1));
      continue;
    end if;
    v_target := legacy.merge_target(s.old_id);
    v_merge := v_target is not null;
    v_target := coalesce(v_target, s.old_id);
    begin
      delete from legacy.person where old_company = s.old_id;
      delete from legacy.idmap where old_company = s.old_id;
      v_counts := legacy.import_studio(s.old_id, v_target, v_merge);
      insert into public.legacy_imports (old_company_id, company_id, studio_name, status, detail)
      values (s.old_id, v_target, s.name, case when v_merge then 'merged' else 'imported' end, v_counts)
      on conflict (old_company_id) do update
        set company_id = excluded.company_id, status = excluded.status, detail = excluded.detail, imported_at = now();
      v_done := jsonb_set(v_done, array[case when v_merge then 'merged' else 'imported' end],
                          to_jsonb((v_done->>(case when v_merge then 'merged' else 'imported' end))::int + 1));
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into public.legacy_imports (old_company_id, studio_name, status, detail)
      values (s.old_id, s.name, 'failed', jsonb_build_object('error', v_err, 'merge_into', case when v_merge then v_target end))
      on conflict (old_company_id) do update set status = 'failed', detail = excluded.detail, imported_at = now();
      v_done := jsonb_set(v_done, '{failed}', to_jsonb((v_done->>'failed')::int + 1));
    end;
  end loop;
  return v_done;
end $$;

-- Old count vs what the studio holds now, per table and studio. A merged
-- studio may hold more than the old app had (its own new work); never less.
create or replace view legacy.report as
with studios as (
  select li.old_company_id as old_id, li.company_id, li.studio_name, li.status from public.legacy_imports li
   where li.status in ('imported', 'merged')
), old as (
  select st.old_id, 'clients' t, (select count(*) from legacy.rows('clients', st.old_id) r) n from studios st
  union all select st.old_id, 'projects', (select count(*) from legacy.rows('projects', st.old_id) r) from studios st
  union all select st.old_id, 'shoots', (select count(*) from legacy.rows('shoots', st.old_id) r) from studios st
  union all select st.old_id, 'deliverables', (select count(*) from legacy.src where tbl in ('deliverables', 'deliverables_2') and co = st.old_id::text) from studios st
  union all select st.old_id, 'tasks', (select count(*) from legacy.rows('tasks', st.old_id) r) from studios st
  union all select st.old_id, 'people', (select count(distinct coalesce(case when r->>'firebase_uid' !~ '^(offline_|manual_emp_)' then nullif(lower(btrim(r->>'email')), '') end, r->>'firebase_uid'))
                                            from legacy.src where tbl in ('admins', 'employees') and co = st.old_id::text) from studios st
  union all select st.old_id, 'crew_bookings', (select count(*) from legacy.rows('team_assignment_slots', st.old_id) r) from studios st
  union all select st.old_id, 'invoices', (select count(*) from legacy.rows('invoices', st.old_id) r) from studios st
  union all select st.old_id, 'payments', (select count(*) from legacy.rows('received_payments', st.old_id) r)
                                        + (select count(*) from legacy.rows('invoice_payments', st.old_id) r where r->>'received_payment_id' is null) from studios st
  union all select st.old_id, 'expenses', (select count(*) from legacy.rows('expenses', st.old_id) r) from studios st
  union all select st.old_id, 'leads', (select count(*) from legacy.src where tbl in ('crm_leads', 'enquiries', 'leads') and co = st.old_id::text) from studios st
), money_old as (
  select st.old_id,
         (select coalesce(sum((s.r->>'amount')::numeric), 0) from legacy.rows('received_payments', st.old_id) s(r) where s.r->>'status' = 'paid')
       + (select coalesce(sum((r->>'amount')::numeric), 0) from legacy.rows('invoice_payments', st.old_id) r where r->>'received_payment_id' is null) as received_old,
         (select coalesce(sum((r->>'amount')::numeric), 0) from legacy.rows('expenses', st.old_id) r) as expenses_old
    from studios st
)
select st.studio_name, st.status, st.old_id, st.company_id, o.t as what, o.n as old_count,
       (st2.detail->>o.t)::bigint as new_count,
       case when st.status = 'imported' and (st2.detail->>o.t)::bigint <> o.n then 'CHECK'
            when st.status = 'merged' and (st2.detail->>o.t)::bigint < o.n then 'CHECK'
            else 'ok' end as verdict,
       m.received_old,
       (select coalesce(sum(amount), 0) from public.received_payments rp where rp.company_id = st.company_id and rp.status = 'paid') as received_new,
       m.expenses_old,
       (select coalesce(sum(amount), 0) from public.expenses e where e.company_id = st.company_id) as expenses_new
  from studios st
  join public.legacy_imports st2 on st2.old_company_id = st.old_id
  join old o on o.old_id = st.old_id
  join money_old m on m.old_id = st.old_id;
