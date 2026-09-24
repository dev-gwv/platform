-- An enquiry is a lead nobody has called yet.
--
-- 0043 split them, and its reasoning was sound at the time: an enquiry is what
-- arrives, a lead is what someone owns and chases, and mixing the two makes
-- the lead list a place nobody trusts. But the cost of answering that with a
-- second table was a second page, a second API module, a second nav entry and
-- a "convert" step that exists only to move a row between two shapes of the
-- same thing.
--
-- The same distinction survives as a LABEL. `crm_leads` already carries
-- `last_contacted_at`, and a lead in status 'new' that nothing has stamped is
-- exactly an unworked enquiry -- which the app already computes as
-- `isUncontacted` and now shows as an "Uncontacted" badge on the row.
--
-- Nothing is dropped. `enquiries` keeps every row and its API keeps working;
-- this migration only makes sure the unworked ones are visible in the one list
-- people now look at.

-- Already-converted enquiries are skipped: converting is what created their
-- lead, and copying them again would be the duplicate this fold is meant to
-- remove. Phone matches are skipped for the same reason -- capture_lead has
-- always deduped on phone_norm, so a lead with that number is that person.
insert into crm_leads (
  company_id, name, phone, phone_norm, email, source, status, lost_reason,
  assigned_to, notes, source_meta, created_at
)
select
  e.company_id,
  e.name,
  e.phone,
  crm_normalize_phone(e.phone),
  e.email,
  'enquiry',
  case e.enquiry_status
    -- 'reviewed' means someone read it, not that anyone rang: still new work.
    when 'contacted' then 'contacted'
    when 'closed'    then 'lost'
    else 'new'
  end,
  -- enforce_lost_reason (0037) refuses a lost lead with no reason, and it is
  -- right to: "lost" with no why is the row nobody can learn anything from.
  -- A closed enquiry has one, and this is it.
  case when e.enquiry_status = 'closed'
       then 'Enquiry closed before anyone worked it'
  end,
  e.assigned_to,
  e.message,
  -- The studio's own free-text source ("wedding expo, Jaipur") has no home in
  -- the lead's source enum, so it is kept whole rather than flattened away.
  jsonb_strip_nulls(jsonb_build_object('enquiry_id', e.id, 'enquiry_source', e.source)),
  e.created_at
from enquiries e
where e.converted_lead_id is null
  and not exists (
    select 1 from crm_leads l
     where l.company_id = e.company_id
       and l.source_meta ->> 'enquiry_id' = e.id::text
  )
  and not exists (
    select 1 from crm_leads l
     where l.company_id = e.company_id
       and l.phone_norm is not null
       and l.phone_norm = crm_normalize_phone(e.phone)
  );

-- Re-running the file adds nothing: the enquiry_id guard above is the key, and
-- it is why source_meta carries the id at all.
create index if not exists crm_leads_enquiry_id_idx
  on crm_leads ((source_meta ->> 'enquiry_id'))
  where source_meta ? 'enquiry_id';
