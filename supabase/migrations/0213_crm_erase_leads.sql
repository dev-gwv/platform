-- 0213: permanent erasure of leads.
--
-- Until now a studio could only ARCHIVE a lead: the row, its contact copy, the
-- Facebook import log and every message stayed forever unless someone with
-- database access removed them by hand. That is not an answer to "how do I
-- delete this person's data", which is what a data-deletion request (and Meta's
-- app review) asks.
--
-- crm_erase_leads removes a lead and every copy of the person's details:
--   * the lead itself (cascades: notes and activities, events, cadences,
--     quotes, tags, functions, workflow runs, sequence sends);
--   * anyone merged into it (a merged duplicate is the same person);
--   * the contact row, when no other lead still uses it;
--   * the Facebook import log rows for them (name, phone, email);
--   * the enquiry it was converted from.
-- and scrubs what must stay for the books but must not keep the person:
--   * referral submissions that named them (the reward record stays);
--   * queued/sent messages to them (the wallet charge stays, the address,
--     text and link go);
--   * name, phone, email and notes inside the audit trail entries for the lead.
--
-- Only ARCHIVED leads, so nothing live is erased by a mis-click: the studio
-- archives first (with a reason), then deletes permanently.
--
-- Called by POST /crm/leads/erase. Returns how many leads were erased.

create or replace function crm_erase_leads(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_all     uuid[];
  v_contacts uuid[];
  v_phones  text[];
  v_emails  text[];
  v_n       int;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  if array_length(p_ids, 1) > 200 then
    raise exception 'too many leads at once' using errcode = '22023';
  end if;

  -- Archived leads of this studio, plus everything merged into them.
  with recursive picked as (
    select l.id from crm_leads l
     where l.id = any(p_ids) and l.company_id = v_company and l.is_archived
    union
    select c.id from crm_leads c join picked p on c.merged_into = p.id
     where c.company_id = v_company
  )
  select array_agg(id) into v_all from picked;
  if v_all is null then return 0; end if;

  select coalesce(array_agg(distinct contact_id) filter (where contact_id is not null), '{}'),
         coalesce(array_agg(distinct phone_norm) filter (where phone_norm is not null), '{}'),
         coalesce(array_agg(distinct lower(email)) filter (where email is not null and email <> ''), '{}')
    into v_contacts, v_phones, v_emails
    from crm_leads where id = any(v_all);

  -- What must stay for the books, without the person.
  update audit_logs
     set before = case when before is null then null
                       else before - 'name' - 'phone' - 'email' - 'notes' - 'alternate_phone' end,
         after  = case when after is null then null
                       else after  - 'name' - 'phone' - 'email' - 'notes' - 'alternate_phone' end
   where company_id = v_company
     and entity_type = 'crm_lead'
     and entity_id = any(select x::text from unnest(v_all) x);

  update referral_submissions
     set client_name = 'Erased', client_phone = null, client_email = null, notes = null
   where company_id = v_company and linked_lead_id = any(v_all);

  update message_outbox
     set to_address = 'erased', vars = '[]'::jsonb, subject = null, body = null, link = null
   where company_id = v_company
     and ((entity_type = 'crm_lead' and entity_id = any(v_all))
          or (channel = 'whatsapp' and crm_normalize_phone(to_address) = any(v_phones))
          or (channel = 'email' and lower(to_address) = any(v_emails)));

  -- The copies that carry no reason to stay.
  delete from fb_lead_imports
   where company_id = v_company
     and (lead_id = any(v_all)
          or crm_normalize_phone(phone) = any(v_phones)
          or lower(email) = any(v_emails));

  delete from enquiries where company_id = v_company and converted_lead_id = any(v_all);

  delete from crm_leads where id = any(v_all) and company_id = v_company;
  get diagnostics v_n = row_count;

  -- The contact goes with the last lead that used it.
  delete from crm_contacts c
   where c.company_id = v_company
     and c.id = any(v_contacts)
     and not exists (select 1 from crm_leads l where l.contact_id = c.id);

  return v_n;
end;
$$;

revoke all on function crm_erase_leads(uuid[]) from public, anon;
grant execute on function crm_erase_leads(uuid[]) to authenticated;
