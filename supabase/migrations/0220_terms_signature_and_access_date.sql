-- 0220: a client signs the terms with a finger, and the platform admin sets
-- a studio's access to an exact date.
--
-- The owner opened a client's terms link and found only "I have read these
-- terms and I agree": no place to sign. The agreement page now carries a
-- signature pad; the drawing (a small PNG data URL) is kept on the document
-- beside the name, time and IP 0017 already records, and shows on the
-- client's copy and the studio's.
--
-- The old Studio Access board extended a studio by 30, 90 or 180 days or to
-- a date the owner picked; ours only knew whole months. platform_set_access_until
-- sets plan_expiry to the end of a chosen day in India time.

alter table project_terms_documents
  add column if not exists acknowledged_signature text;
alter table project_terms_documents
  drop constraint if exists ptd_signature_shape;
alter table project_terms_documents
  add constraint ptd_signature_shape check (
    acknowledged_signature is null
    or (acknowledged_signature like 'data:image/png;base64,%' and length(acknowledged_signature) <= 400000)
  );

-- Stored right after acknowledge_terms() on the same link: only a document
-- agreed in the last ten minutes and not yet signed takes a signature, so an
-- old link cannot overwrite what was signed.
create or replace function terms_sign(p_raw text, p_signature text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
begin
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 400000 then
    return false;
  end if;
  update project_terms_documents d
     set acknowledged_signature = p_signature
    from access_tokens t
   where t.purpose = 'terms_ack' and t.token_hash = v_hash
     and d.id = t.subject_id
     and d.acknowledged_at > now() - interval '10 minutes'
     and d.acknowledged_signature is null;
  return found;
end;
$$;

-- The client's own copy, read through their link.
create or replace function terms_signature_for_token(p_raw text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.acknowledged_signature
    from access_tokens t
    join project_terms_documents d on d.id = t.subject_id
   where t.purpose = 'terms_ack'
     and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and t.revoked_at is null
   limit 1
$$;

revoke all on function terms_sign(text, text) from public, anon, authenticated;
revoke all on function terms_signature_for_token(text) from public, anon, authenticated;
grant execute on function terms_sign(text, text) to service_role;
grant execute on function terms_signature_for_token(text) to service_role;

-- Access to the end of a chosen day (India time). Past dates are refused:
-- ending access now is platform_expire_plan().
create or replace function platform_set_access_until(p_company_id uuid, p_until date)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_expiry timestamptz;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  if p_until is null or p_until < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'pick today or a later date' using errcode = '22023';
  end if;
  update companies
     set plan_expiry = (p_until + 1)::timestamp at time zone 'Asia/Kolkata'
   where id = p_company_id
   returning plan_expiry into v_expiry;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_plan_set_until',
            jsonb_build_object('until', p_until, 'by', auth.uid(), 'new_expiry', v_expiry));
  return v_expiry;
end;
$$;
revoke all on function platform_set_access_until(uuid, date) from public, anon;
grant execute on function platform_set_access_until(uuid, date) to authenticated;
