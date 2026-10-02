-- 0231: A client's Accept tells the studio.
--
-- The client's quotation page has always said "Accepted by Priya -- the studio
-- has been told" after they accept. Nothing told anyone: respond_to_quotation
-- (0190) stamped accepted_at and stopped there, so the owner found out only by
-- opening the quotation. Terms agreement already rings the bell for the owner
-- and whoever created the project (acknowledge_terms, 0163); a quotation now
-- does the same, once per quotation and person.
--
-- Accepting never creates an invoice, books anything or counts as money: a
-- quotation accepted is a promise, and the next step (Create the invoice) stays
-- the studio's.
--
-- respond_to_quotation is copied from 0190 (its latest definition) with the
-- same five arguments, so create or replace keeps a single function.

create or replace function respond_to_quotation(
  p_raw        text,
  p_accept     boolean,
  p_name       text default null,
  p_ip         text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote   uuid := resolve_access_token('quotation', p_raw);
  v_changed boolean;
  v_q       record;
  v_who     uuid;
begin
  if v_quote is null then
    return false;
  end if;
  -- A quotation the studio has hidden cannot be read, so it cannot be accepted.
  if not exists (
    select 1 from project_quotations q join projects p on p.id = q.project_id
     where q.id = v_quote and coalesce(q.show_quotation, true) and p.show_quotation
  ) then
    return false;
  end if;
  if p_accept then
    update project_quotations
       set accepted_at = now(), accepted_by_name = p_name,
           accepted_ip = p_ip, accepted_user_agent = p_user_agent,
           declined_at = null
     where id = v_quote and accepted_at is null;
  else
    update project_quotations
       set declined_at = now()
     where id = v_quote and accepted_at is null;
  end if;
  v_changed := found;

  -- Tell the studio about a fresh accept: the owner, and whoever created the
  -- project. The dedupe key keeps an accept, decline, accept from ringing twice.
  if v_changed and p_accept then
    select q.company_id, q.project_id, p.name as project_name,
           (q.snapshot ->> 'total')::numeric as total
      into v_q
      from project_quotations q join projects p on p.id = q.project_id
     where q.id = v_quote;
    for v_who in
      select distinct u from (
        select owner_user_id as u from companies where id = v_q.company_id
        union
        select created_by from projects where id = v_q.project_id
      ) w
      where u is not null and exists (select 1 from users where user_id = u and company_id = v_q.company_id)
    loop
      perform create_notification(
        v_q.company_id, v_who, 'quotation_accepted',
        coalesce(nullif(trim(p_name), ''), 'The client') || ' accepted the quotation',
        coalesce(v_q.project_name, '') ||
          case when v_q.total is not null and v_q.total > 0
               then ' · ₹' || to_char(v_q.total, 'FM99,99,99,99,990') else '' end,
        'quotation_accepted:' || v_quote || ':' || v_who,
        'project', v_q.project_id, 'info',
        '/projects/' || v_q.project_id || '/quotation');
    end loop;
  end if;
  return v_changed;
end;
$$;
revoke all on function respond_to_quotation(text, boolean, text, text, text) from public;
grant execute on function respond_to_quotation(text, boolean, text, text, text) to anon, authenticated;
