-- 0299: a note on a booked person (like a cell comment), and wedding QR codes
-- apart from partners (enquiry_partners.kind + project_id).
--
-- Owner, 10 Nov:
--   * "they should have the option to add any note on any assigned
--     photographer ... in the Google Sheet we would use the comment option,
--     visible on hovering over it." A booking (team_assignment_slots) carries
--     one short note, who wrote it and when. It is not money: anyone who can
--     see the booking reads it (cost_notes stays the payout's own note).
--   * Wedding QR codes are not partners. A partner is a shop or vendor that
--     keeps the studio's flex at its counter; a wedding QR is one the studio
--     prints and places at a client's wedding so guests can enquire. Same
--     machinery (enquiry_partners, ?p=<code>, the counts), told apart by
--     kind = 'wedding' and tied to the project it was made for.
--   * The deliverable's own note for the team uses deliverables.internal_notes
--     (0006), which needs nothing here.
--
-- Safe to run twice.

-- ── a note on a booking ────────────────────────────────────────────────
alter table team_assignment_slots
  add column if not exists note    text,
  add column if not exists note_by uuid references users (user_id) on delete set null,
  add column if not exists note_at timestamptz;
alter table team_assignment_slots drop constraint if exists team_assignment_slots_note_len;
alter table team_assignment_slots add constraint team_assignment_slots_note_len
  check (note is null or char_length(note) <= 500);

-- ── wedding QR codes ───────────────────────────────────────────────────
alter table enquiry_partners
  add column if not exists kind       text not null default 'partner',
  add column if not exists project_id uuid references projects (id) on delete set null;
alter table enquiry_partners drop constraint if exists enquiry_partners_kind_check;
alter table enquiry_partners add constraint enquiry_partners_kind_check check (kind in ('partner', 'wedding'));

-- A partner's name is unique among partners, a wedding QR's among wedding QRs.
drop index if exists enquiry_partners_name_idx;
create unique index if not exists enquiry_partners_kind_name_idx on enquiry_partners (company_id, kind, lower(name));
create index if not exists enquiry_partners_project_idx on enquiry_partners (project_id) where project_id is not null;
create index if not exists enquiry_partners_company_kind_idx on enquiry_partners (company_id, kind);

grant update (kind, project_id) on enquiry_partners to authenticated;

/**
 * Copied from 0274 with one change: a clash is looked for among partners
 * only (kind = 'partner'), since a wedding QR may share a name with one.
 */
create or replace function create_enquiry_partner(
  p_name  text,
  p_label text default null,
  p_phone text default null,
  p_party uuid default null,
  p_notes text default null,
  p_token text default null
)
returns enquiry_partners
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_clash   enquiry_partners;
  v_row     enquiry_partners;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Give the partner a name.' using errcode = '22023';
  end if;
  select * into v_clash from enquiry_partners
   where company_id = v_company and kind = 'partner' and lower(name) = lower(trim(p_name));
  if found then
    if v_clash.archived_at is not null then
      raise exception 'An archived partner has this name. Bring them back instead.' using errcode = '23505';
    end if;
    raise exception 'You already have a partner with this name.' using errcode = '23505';
  end if;
  if p_party is not null and not exists (select 1 from parties where id = p_party and company_id = v_company) then
    raise exception 'That vendor was not found.' using errcode = '22023';
  end if;
  perform enquiry_main_form_for(v_company);
  insert into enquiry_partners (company_id, name, label, phone, party_id, notes, code, view_token, created_by)
  values (v_company, trim(p_name), nullif(left(trim(coalesce(p_label, '')), 120), ''),
          nullif(trim(coalesce(p_phone, '')), ''), p_party, nullif(trim(coalesce(p_notes, '')), ''),
          enquiry_new_partner_code(), p_token, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function create_enquiry_partner(text, text, text, uuid, text, text) from public, anon;
grant execute on function create_enquiry_partner(text, text, text, uuid, text, text) to authenticated;

/**
 * A wedding QR for one of the studio's projects. One per project: asking
 * again gives back the one there (and brings it back if it was ended). The
 * name is the project's ("Priya & Rahul's Wedding"), made unique among the
 * studio's wedding QRs; there is no partner page, so view_token stays null.
 */
create or replace function create_wedding_qr(p_project uuid, p_name text default null)
returns enquiry_partners
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_project text;
  v_name    text;
  v_try     text;
  v_n       int := 1;
  v_row     enquiry_partners;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select name into v_project from projects where id = p_project and company_id = v_company;
  if not found then
    raise exception 'That project was not found.' using errcode = '22023';
  end if;
  select * into v_row from enquiry_partners
   where company_id = v_company and kind = 'wedding' and project_id = p_project
   order by archived_at nulls first, created_at
   limit 1;
  if found then
    if v_row.archived_at is not null then
      update enquiry_partners set archived_at = null where id = v_row.id returning * into v_row;
    end if;
    return v_row;
  end if;
  v_name := left(trim(coalesce(nullif(trim(coalesce(p_name, '')), ''), v_project)), 70);
  if char_length(v_name) < 2 then v_name := 'Wedding'; end if;
  v_try := v_name;
  while exists (select 1 from enquiry_partners
                 where company_id = v_company and kind = 'wedding' and lower(name) = lower(v_try)) loop
    v_n := v_n + 1;
    v_try := v_name || ' (' || v_n || ')';
  end loop;
  perform enquiry_main_form_for(v_company);
  insert into enquiry_partners (company_id, kind, project_id, name, occasion, code, view_token, created_by)
  values (v_company, 'wedding', p_project, v_try, v_name, enquiry_new_partner_code(), null, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function create_wedding_qr(uuid, text) from public, anon;
grant execute on function create_wedding_qr(uuid, text) to authenticated;
