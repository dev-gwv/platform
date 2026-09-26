-- Quotation links follow the studio's "Show to client" switch, and carry the
-- project's own terms and display choices.
--
--   * The switch did nothing to a link already sent. The public reader only
--     looked at the per-quotation flag, which nothing in the app ever turns
--     off, so hiding a quotation left every issued link showing it. The
--     reader now also checks projects.show_quotation, and a hidden link
--     returns one row that says so and nothing else -- no prices, no names.
--     Accepting through a hidden link is refused for the same reason.
--   * A link issued without a terms or display-prefs snapshot (every link
--     until the studio page started sending them) showed the default terms
--     and every section. It now falls back to what the project holds.
--   * The quotation number is the project's, as on the studio's own page, so
--     a re-issued link quotes the number the client already has. Same rule as
--     quotationNumber() in packages/contracts.
--   * The studio's custom brand colour rides along for the stripe on top.
--
-- The return type grows a column, so the function is dropped and recreated;
-- grants are restated as 0126 left them.

-- ── get_quotation_for_token — copied from 0162 ──────────────────────
drop function if exists get_quotation_for_token(text);
create or replace function get_quotation_for_token(p_raw text)
returns table (
  snapshot jsonb, notes text, accepted_at timestamptz, accepted_by_name text,
  declined_at timestamptz, client_name text, company_name text,
  logo_url text, company_phone text, company_email text, company_address text, gstin text,
  shoots_schedule jsonb, terms_text text, display_prefs jsonb,
  show_quotation boolean, expires_at timestamptz, revoked boolean, access_count int,
  -- document extras
  company_legal_name text, company_website text, document_footer_note text,
  client_phone text, client_email text, client_address text,
  project_name text, project_status text,
  quotation_number text, issued_at timestamptz, quotation_id uuid,
  deliverables jsonb, deliverables_2 jsonb,
  total_received numeric, balance_due numeric,
  brand_color text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_quote uuid;
  v_visible boolean;
  v_studio text;
begin
  select at.subject_id into v_quote from access_tokens at
   where at.purpose = 'quotation'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_quote is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'quotation' and at.token_hash = v_hash;
  update project_quotations q set access_count = coalesce(q.access_count, 0) + 1
   where q.id = v_quote;

  select coalesce(q.show_quotation, true) and p.show_quotation,
         coalesce(co.display_name, co.name)
    into v_visible, v_studio
    from project_quotations q
    join projects p on p.id = q.project_id
    left join companies co on co.id = q.company_id
   where q.id = v_quote
     and q.revoked_at is null
     and (q.expires_at is null or q.expires_at > now());
  if not found then
    return;
  end if;

  -- Hidden by the studio: say so, and nothing else.
  if not v_visible then
    return query
    select jsonb_build_object('items', '[]'::jsonb, 'package_cost', 0, 'add_ons', 0,
                              'total', 0, 'project_name', ''),
           null::text, null::timestamptz, null::text, null::timestamptz,
           null::text, v_studio,
           null::text, null::text, null::text, null::text, null::text,
           '[]'::jsonb, null::text, '{}'::jsonb,
           false, null::timestamptz, false, 0,
           null::text, null::text, null::text,
           null::text, null::text, null::text,
           null::text, null::text,
           null::text, null::timestamptz, null::uuid,
           '[]'::jsonb, '[]'::jsonb,
           0::numeric, 0::numeric,
           null::text;
    return;
  end if;

  return query
  select q.snapshot, q.notes, q.accepted_at, q.accepted_by_name, q.declined_at,
         cl.name, coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address, co.invoice_gst_number,
         coalesce(q.shoots_schedule, '[]'::jsonb),
         -- The terms and choices sent with the link; the project's own when
         -- the link was issued without any.
         coalesce(nullif(btrim(q.terms_text), ''), nullif(btrim(p.quotation_terms), '')),
         case when q.display_prefs is null or q.display_prefs = '{}'::jsonb
              then coalesce(p.quotation_display_prefs, '{}'::jsonb)
              else q.display_prefs end,
         true, q.expires_at,
         (q.revoked_at is not null),
         coalesce(q.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         cl.phone, cl.email, cl.address,
         p.name, p.status::text,
         -- The project's number, as the studio's page shows it.
         coalesce(nullif(rtrim(btrim(co.quote_number_prefix), '-'), ''), 'Q')
           || '-' || upper(substring(p.id::text, 1, 8)),
         q.created_at, q.id,
         -- The real rows, so the document can show estimated dates and which
         -- items carry an extra charge rather than a flat "Included".
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key = 'primary'
              and coalesce(d.show_on_quotation, true)
              and d.visibility_scope = 'client' and d.status <> 'cancelled'), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key <> 'primary'
              and coalesce(d.show_on_quotation, true)
              and d.visibility_scope = 'client' and d.status <> 'cancelled'), '[]'::jsonb),
         coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id and x.status = 'paid'), 0),
         greatest(coalesce(p.total_cost, 0)
                  - coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id and x.status = 'paid'), 0), 0),
         case when th.is_custom_theme then coalesce(th.primary_color, th.custom_color) end
    from project_quotations q
    join projects p on p.id = q.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = q.company_id
    left join company_theme_settings th on th.company_id = q.company_id
   where q.id = v_quote;
end;
$$;

revoke all on function get_quotation_for_token(text) from public;
grant execute on function get_quotation_for_token(text) to anon, authenticated;

-- ── respond_to_quotation — copied from 0042, refused while hidden ──
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
declare v_quote uuid := resolve_access_token('quotation', p_raw);
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
  return found;
end;
$$;

revoke all on function respond_to_quotation(text, boolean, text, text, text) from public;
grant execute on function respond_to_quotation(text, boolean, text, text, text) to anon, authenticated;
