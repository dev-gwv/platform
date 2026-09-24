-- Projects section fixes.
--
-- create_project_with_details (0006) saved every payment the Create Project
-- wizard sent as plain paid money: it inserted only amount, date, mode,
-- reference and notes. A "promised" advance therefore showed as received,
-- GST details were dropped, and the payment carried no client, unlike
-- one recorded from the project page. Same body, with those fields kept.

CREATE OR REPLACE FUNCTION public.create_project_with_details(p_client_id uuid, p_name text, p_package_cost numeric DEFAULT 0, p_status text DEFAULT 'active'::text, p_show_quotation boolean DEFAULT false, p_deliverables jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_company uuid := get_current_company_id();
  v_project uuid;
begin
  if v_company is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id and company_id = v_company) then
    raise exception 'client not in this studio' using errcode = '42501';
  end if;

  insert into projects (company_id, client_id, name, package_cost, status, show_quotation, created_by)
    values (v_company, p_client_id, p_name, coalesce(p_package_cost, 0), coalesce(p_status, 'active'),
            coalesce(p_show_quotation, false), auth.uid())
    returning id into v_project;

  insert into deliverables (
    company_id, project_id, list_key, title, description,
    is_additional_charge, additional_charge_amount, visibility_scope,
    show_on_quotation, estimated_date, start_rule, delivery_days_after_start,
    work_type, internal_notes
  )
  select
    v_company, v_project,
    coalesce(e ->> 'list_key', 'primary'),
    e ->> 'title',
    e ->> 'description',
    coalesce((e ->> 'is_additional_charge')::boolean, false),
    coalesce((e ->> 'additional_charge_amount')::numeric, 0),
    coalesce(e ->> 'visibility_scope', 'client'),
    coalesce((e ->> 'show_on_quotation')::boolean, true),
    nullif(e ->> 'estimated_date', '')::date,
    coalesce(e ->> 'start_rule', 'whole_project'),
    nullif(e ->> 'delivery_days_after_start', '')::int,
    e ->> 'work_type',
    e ->> 'internal_notes'
  from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb)) as e
  where (e ->> 'title') is not null;

  insert into received_payments (
    company_id, project_id, client_id, amount, paid_on, mode, reference, notes,
    status, description, is_gst, gst_number, recorded_by
  )
  select
    v_company, v_project, p_client_id,
    (e ->> 'amount')::numeric,
    coalesce(nullif(e ->> 'paid_on', '')::date, current_date),
    e ->> 'mode', e ->> 'reference', e ->> 'notes',
    -- A promised advance stays promised: only 'pending' is kept, anything
    -- else (including nothing) means the money came in.
    case when e ->> 'status' = 'pending' then 'pending' else 'paid' end,
    nullif(e ->> 'description', ''),
    coalesce((e ->> 'is_gst')::boolean, false),
    nullif(e ->> 'gst_number', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as e
  where (e ->> 'amount') is not null and (e ->> 'amount')::numeric > 0;

  return v_project;
end;
$$;
