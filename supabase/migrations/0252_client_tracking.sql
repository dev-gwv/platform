-- 0252: the client tracking page, on the same private link (0184).
--
-- The couple's one question is "where is it?". The link already shows the
-- days, the work, the money and the terms; this turns it into a tracker:
--
-- 1. Five plain words for each photo or film: Not started, Being edited
--    ("in_progress"), Final checks (handed in, the studio has not checked it
--    yet -- no link), Ready to view (approved, with the client, or client
--    approved -- with its link), Delivered.
-- 2. get_client_portal gains what the tracker needs: when the quotation was
--    accepted and the terms agreed, how many shoot days are shot and how many
--    have every card backed up (hidden for studios that keep no data
--    records), the last five things that happened, and the next payment due.
--    It takes p_count: the studio's own "See it as the client" reads it
--    without counting a client view.
-- 3. The studio keeps the live link, so "Share with client" can show and copy
--    it again instead of making a new one (which used to stop the client's).
--    The raw token sits in client_portal_link_tokens, service-only; the link
--    row still holds just the hash.
-- 4. "Looks great" on work waiting for the client marks it Client approved.
--
-- get_client_portal is copied from 0251 and client_portal_leave_feedback from
-- 0184; copy them from here from now on.

-- ── 1. the client's words ────────────────────────────────────────
create or replace function client_portal_status(p_status text, p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p_status = 'completed' then 'delivered'
           when p_status = 'review' and coalesce(p_code, 'with_client') in ('approved', 'with_client', 'client_approved') then 'ready'
           when p_status = 'review' then 'final_checks'
           when p_status = 'in_progress' then 'in_progress'
           else 'not_started'
         end
$$;

-- ── 3. the live link, kept for the studio ────────────────────────
create table if not exists client_portal_link_tokens (
  link_id    uuid primary key references client_portal_links (id) on delete cascade,
  token      text not null,
  created_at timestamptz not null default now()
);
alter table client_portal_link_tokens enable row level security;
revoke all on client_portal_link_tokens from public, anon, authenticated;
grant all on client_portal_link_tokens to service_role;

-- ── 2. the page ──────────────────────────────────────────────────
drop function if exists get_client_portal(text);
-- The whole page. Counts the view unless p_count is false (the studio's own
-- "See it as the client", which never reaches the public read).
create or replace function get_client_portal(p_raw text, p_count boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link client_portal_links;
  v_out jsonb;
  v_received numeric;
begin
  v_link := client_portal_link_for_token(p_raw);
  if v_link.id is null then
    return null;
  end if;

  select coalesce(sum(rp.amount), 0) into v_received
    from received_payments rp
   where rp.project_id = v_link.project_id and rp.company_id = v_link.company_id
     and coalesce(rp.status, 'paid') = 'paid';

  select jsonb_build_object(
    'studio', jsonb_build_object(
      'name', coalesce(co.display_name, co.name),
      'logo_url', coalesce(th.logo_url, co.invoice_logo_url, co.avatar_url),
      'phone', co.invoice_phone,
      'email', co.invoice_email,
      'website', co.website,
      'city', co.city,
      'brand_color', case when th.is_custom_theme then coalesce(th.primary_color, th.custom_color) end,
      'theme_preset', th.preset_key
    ),
    'project', jsonb_build_object(
      'name', p.name,
      'client_name', cl.name,
      'status', p.status
    ),
    'options', jsonb_build_object(
      'show_payments', v_link.show_payments,
      'allow_feedback', v_link.allow_feedback,
      'expires_at', v_link.expires_at
    ),
    'shoots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'shoot_date', s.shoot_date,
               'start_at', s.start_at, 'end_at', s.end_at, 'guests', s.guests,
               'location', s.location, 'map_link', s.map_link,
               'status', s.status,
               'team', case when v_link.show_team then coalesce((
                 select jsonb_agg(jsonb_build_object('first_name', t.first_name, 'role', t.role)
                                  order by t.role nulls last, t.first_name)
                   from (
                     select distinct split_part(trim(u.name), ' ', 1) as first_name,
                            nullif(trim(x.service_name), '') as role
                       from (
                         select ts.user_id, ts.service_name from team_assignment_slots ts
                          where ts.shoot_id = s.id and ts.company_id = s.company_id and ts.status = 'booked'
                         union
                         select sa.user_id, sa.service_name from shoot_assignments sa
                          where sa.shoot_id = s.id and sa.company_id = s.company_id and sa.status <> 'declined'
                       ) x
                       join users u on u.user_id = x.user_id and u.company_id = s.company_id
                      where u.deleted_at is null
                   ) t), '[]'::jsonb) else '[]'::jsonb end
             ) order by s.shoot_date nulls last, s.start_at nulls last, s.created_at)
        from shoots s
       where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'status', client_portal_status(d.status, d.custom_status_code),
               'expected_date', d.estimated_date,
               'delivered_at', d.delivered_at,
               'delivery_link', case when client_portal_status(d.status, d.custom_status_code) in ('ready', 'delivered')
                                   then nullif(trim(d.delivery_link), '') end,
               'shoot_name', (select s.name from shoots s where s.id = d.shoot_id and s.company_id = d.company_id),
               'feedback', (
                 select jsonb_build_object('kind', f.kind, 'message', f.message, 'created_at', f.created_at)
                   from client_portal_feedback f
                  where f.deliverable_id = d.id and f.company_id = d.company_id
                  order by f.created_at desc limit 1)
             ) order by d.estimated_date nulls last, d.created_at)
        from deliverables d
       where d.project_id = p.id and d.company_id = p.company_id
         and d.visibility_scope = 'client'
         and coalesce(d.show_on_quotation, true)
         and d.status <> 'cancelled'), '[]'::jsonb),
    'money', case when v_link.show_payments then jsonb_build_object(
      'total', coalesce(p.total_cost, 0),
      'received', v_received,
      'balance', greatest(coalesce(p.total_cost, 0) - v_received, 0),
      -- The next payment: the earliest sent invoice with money still due.
      'next_due', (
        select jsonb_build_object('amount', i.balance_due, 'due_date', i.due_date)
          from invoices i
         where i.project_id = p.id and i.company_id = p.company_id
           and i.status not in ('draft', 'cancelled') and coalesce(i.balance_due, 0) > 0
         order by i.due_date nulls last, i.invoice_date
         limit 1),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
                 'due_date', i.due_date, 'status', i.status, 'total', i.total,
                 'balance_due', i.balance_due) order by i.invoice_date, i.created_at)
          from invoices i
         where i.project_id = p.id and i.company_id = p.company_id
           and i.status not in ('draft', 'cancelled')), '[]'::jsonb)
    ) end,
    -- The tracker's first step: the quotation accepted, the terms agreed.
    'booked', jsonb_build_object(
      'quotation_accepted_at', (select max(q.accepted_at) from project_quotations q
                                 where q.project_id = p.id and q.company_id = p.company_id),
      'terms_agreed_at', (select max(t.acknowledged_at) from project_terms_documents t
                           where t.project_id = p.id and t.company_id = p.company_id and t.revoked_at is null)
    ),
    -- Footage safe: of the days shot, how many have every card copied and
    -- backed up. "tracks" is false for a studio that does not record data,
    -- and the step is hidden then.
    'footage', jsonb_build_object(
      'tracks', exists (select 1 from shoot_data_records r where r.company_id = p.company_id),
      'shot', (select count(*) from shoots s
                where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'
                  and s.shoot_date is not null and s.shoot_date <= (now() at time zone 'Asia/Kolkata')::date),
      'safe', (select count(*) from shoots s
                where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'
                  and s.shoot_date is not null and s.shoot_date <= (now() at time zone 'Asia/Kolkata')::date
                  and exists (select 1 from shoot_data_records r where r.shoot_id = s.id
                               and r.data_status <> 'not_required')
                  and not exists (select 1 from shoot_data_records r where r.shoot_id = s.id
                                   and r.data_status not in ('backed_up', 'verified', 'archived', 'not_required')))
    ),
    -- The last five things that happened, newest first, in the client's words.
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('at', u.happened_at, 'text', u.what) order by u.happened_at desc)
        from (
          select * from (
            select s.shoot_date::timestamptz as happened_at, s.name || ' shot' as what
              from shoots s
             where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'
               and s.shoot_date is not null and s.shoot_date < (now() at time zone 'Asia/Kolkata')::date
            union all
            select d.delivered_at, d.title || ' delivered'
              from deliverables d
             where d.project_id = p.id and d.company_id = p.company_id and d.delivered_at is not null
               and d.visibility_scope = 'client' and coalesce(d.show_on_quotation, true) and d.status <> 'cancelled'
            union all
            select n.created_at, d.title || ' is ready to view'
              from deliverable_notes n
              join deliverables d on d.id = n.deliverable_id
             where d.project_id = p.id and d.company_id = p.company_id and n.kind = 'event'
               and n.body like 'moved:review:with_client%'
               and d.visibility_scope = 'client' and coalesce(d.show_on_quotation, true) and d.status <> 'cancelled'
            union all
            select t.acknowledged_at, 'Terms agreed'
              from project_terms_documents t
             where t.project_id = p.id and t.company_id = p.company_id and t.acknowledged_at is not null
               and t.revoked_at is null
            union all
            select rp.paid_on::timestamptz, 'Payment received'
              from received_payments rp
             where v_link.show_payments and rp.project_id = p.id and rp.company_id = p.company_id
               and coalesce(rp.status, 'paid') = 'paid' and rp.paid_on is not null
          ) x
          where x.happened_at is not null
          order by x.happened_at desc
          limit 5
        ) u), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', coalesce(d.title, 'Terms & agreement'),
               'sent_at', coalesce(d.sent_at, d.created_at),
               'agreed_at', d.acknowledged_at, 'agreed_by', d.acknowledged_by_name)
             order by coalesce(d.sent_at, d.created_at) desc)
        from project_terms_documents d
       where d.project_id = p.id and d.company_id = p.company_id
         and d.revoked_at is null and not d.is_draft
         and (d.sent_at is not null or d.acknowledged_at is not null)), '[]'::jsonb)
  ) into v_out
    from projects p
    join companies co on co.id = p.company_id
    left join company_theme_settings th on th.company_id = p.company_id
    left join clients cl on cl.id = p.client_id and cl.company_id = p.company_id
   where p.id = v_link.project_id and p.company_id = v_link.company_id;

  if v_out is not null and coalesce(p_count, true) then
    update client_portal_links
       set view_count = view_count + 1, last_viewed_at = now()
     where id = v_link.id;
  end if;
  return v_out;
end;
$$;
revoke all on function get_client_portal(text, boolean) from public, anon, authenticated;
grant execute on function get_client_portal(text, boolean) to service_role;

-- ── 4. "looks great" ─────────────────────────────────────────────
-- Copied from 0184; "looks great" now also marks the work Client approved.
-- The client says "looks great" or "please change". The project's owner and
-- the studio's managers are told. Returns false when the link, the
-- deliverable or the feedback switch does not allow it, and caps a link at
-- 30 notes a day so a leaked link cannot flood the studio.
create or replace function client_portal_leave_feedback(
  p_raw text, p_deliverable uuid, p_kind text, p_message text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link client_portal_links;
  v_title text;
  v_project text;
  v_owner uuid;
  v_client text;
  v_id uuid;
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 2000), '');
  r uuid;
begin
  if p_kind not in ('approved', 'change_requested') then
    return false;
  end if;
  if p_kind = 'change_requested' and v_msg is null then
    return false;
  end if;
  v_link := client_portal_link_for_token(p_raw);
  if v_link.id is null or not v_link.allow_feedback then
    return false;
  end if;

  select d.title, p.name, p.created_by, cl.name into v_title, v_project, v_owner, v_client
    from deliverables d
    join projects p on p.id = d.project_id and p.company_id = d.company_id
    left join clients cl on cl.id = p.client_id and cl.company_id = p.company_id
   where d.id = p_deliverable
     and d.project_id = v_link.project_id and d.company_id = v_link.company_id
     and d.visibility_scope = 'client' and coalesce(d.show_on_quotation, true)
     and d.status <> 'cancelled';
  if v_title is null then
    return false;
  end if;

  if (select count(*) from client_portal_feedback f
       where f.link_id = v_link.id and f.created_at > now() - interval '1 day') >= 30 then
    return false;
  end if;

  insert into client_portal_feedback (company_id, project_id, link_id, deliverable_id, kind, message)
  values (v_link.company_id, v_link.project_id, v_link.id, p_deliverable, p_kind, v_msg)
  returning id into v_id;

  -- "Looks great" on work waiting for the client marks it Client approved.
  if p_kind = 'approved' then
    update deliverables
       set custom_status_code = 'client_approved'
     where id = p_deliverable and company_id = v_link.company_id
       and status = 'review' and coalesce(custom_status_code, 'with_client') in ('approved', 'with_client');
  end if;

  for r in
    select distinct x from (
      select v_owner as x
       where v_owner is not null and exists (
         select 1 from users u where u.user_id = v_owner and u.company_id = v_link.company_id
            and u.deleted_at is null and u.status = 'active')
      union
      select notification_admin_recipients(v_link.company_id)
    ) s where x is not null
  loop
    perform create_notification(
      v_link.company_id, r, 'client_portal.feedback',
      case when p_kind = 'approved'
           then coalesce(v_client, 'The client') || ' loved ' || v_title
           else coalesce(v_client, 'The client') || ' asked for a change to ' || v_title end,
      coalesce(v_msg, v_project),
      'portal_feedback:' || v_id, 'project', v_link.project_id,
      case when p_kind = 'approved' then 'info' else 'warning' end,
      '/projects/' || v_link.project_id || '?tab=deliverables',
      jsonb_build_object('deliverable_id', p_deliverable, 'kind', p_kind));
  end loop;
  return true;
end;
$$;
revoke all on function client_portal_leave_feedback(text, uuid, text, text) from public, anon, authenticated;
grant execute on function client_portal_leave_feedback(text, uuid, text, text) to service_role;
