-- 0317: the profit report reads each project once (speed check, 22 Nov).
-- Financials > Profit took 6.75 s on a studio with 1,000 projects: 0146 re-ran
-- about thirty correlated sub-selects per project, twice. Same answer, ~10 ms.
-- Safe to run twice (create or replace, arguments unchanged).

-- project_profitability_report: copied from 0146 (its latest definition),
-- the same answer, each project's sums worked out once. In 0146 the CTEs
-- are inlined, so every mention of paid_income or company_expense_total in
-- `calc` and the flags re-ran its correlated sub-select -- about thirty
-- sub-plans a project -- and the whole of it ran twice (summary, then page).
-- Here the payments and expenses are summed once per project with grouped
-- joins, the rows are built once (materialized) and the summary and the page
-- are both read from them. Arguments unchanged, so create or replace is safe.
create or replace function project_profitability_report(
  p_date_from      date default null,
  p_date_to        date default null,
  p_project_id     uuid default null,
  p_client_id      uuid default null,
  p_status         text default null,
  p_search         text default null,
  p_sort_by        text default 'created_at',
  p_sort_direction text default 'desc',
  p_page           int  default 1,
  p_page_size      int  default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company    uuid := get_current_company_id();
  v_search     text := nullif(trim(coalesce(p_search, '')), '');
  v_sort_col   text;
  v_sort_dir   text := case when lower(coalesce(p_sort_direction, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_page       int  := greatest(1, coalesce(p_page, 1));
  v_page_size  int  := least(200, greatest(10, coalesce(p_page_size, 50)));
  v_out        jsonb;
  v_total_count int;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_sort_col := case p_sort_by
    when 'project_name' then 'project_name'
    when 'client_name' then 'client_name'
    when 'total_cost' then 'project_total_value'
    when 'paid_income' then 'paid_income'
    when 'receivables' then 'receivables'
    when 'company_expense_total' then 'company_expense_total'
    when 'gross_profit' then 'gross_profit'
    when 'gross_margin' then 'gross_margin'
    when 'collection_rate' then 'collection_rate'
    when 'status' then 'project_status'
    else 'created_at'
  end;

  -- $1 company, $2 date_from, $3 date_to, $4 project_id, $5 client_id, $6 status, $7 search, $8 page size, $9 offset
  execute format($sql$
    with active_count as (
      select count(*) as n from projects where company_id = $1 and status <> 'cancelled'
    ),
    overhead as (
      select sum(e.amount) as total from expenses e
       where e.company_id = $1 and e.project_id is null and e.is_fixed_overhead
         and ($2::date is null or e.expense_date >= $2) and ($3::date is null or e.expense_date <= $3)
    ),
    pay as (
      select rp.project_id, sum(rp.amount) as total from received_payments rp
       where rp.company_id = $1 and rp.status = 'paid' and rp.project_id is not null
         and ($2::date is null or rp.paid_on >= $2) and ($3::date is null or rp.paid_on <= $3)
       group by rp.project_id
    ),
    spent as (
      select e.project_id, sum(e.amount) as total from expenses e
       where e.company_id = $1 and e.project_id is not null
         and ($2::date is null or e.expense_date >= $2) and ($3::date is null or e.expense_date <= $3)
       group by e.project_id
    ),
    base as materialized (
      select
        p.id as project_id, p.name as project_name, p.client_id, c.name as client_name,
        p.status as project_status, p.created_at, p.total_cost as project_total_value,
        coalesce(pay.total, 0) as paid_income,
        coalesce(spent.total, 0)
        + case when p.status = 'cancelled' then 0 else
          coalesce((select total from overhead) / nullif((select n from active_count), 0), 0)
        end as company_expense_total
      from projects p
      left join clients c on c.id = p.client_id
      left join pay on pay.project_id = p.id
      left join spent on spent.project_id = p.id
      where p.company_id = $1
        and ($4::uuid is null or p.id = $4)
        and ($5::uuid is null or p.client_id = $5)
        and ($6::text is null or p.status = $6)
        and ($7::text is null or p.name ilike '%%' || $7 || '%%' or c.name ilike '%%' || $7 || '%%')
    ),
    calc as materialized (
      select *,
        (project_total_value - paid_income) as receivables,
        (paid_income - company_expense_total) as gross_profit,
        (project_total_value - company_expense_total) as expected_project_profit,
        case when paid_income > 0 then round(((paid_income - company_expense_total) / paid_income * 100)::numeric, 1) else 0 end as gross_margin,
        case when project_total_value > 0 then round(((project_total_value - company_expense_total) / project_total_value * 100)::numeric, 1) else 0 end as expected_margin,
        case when project_total_value > 0 then round((paid_income / project_total_value * 100)::numeric, 1) else 0 end as collection_rate,
        case when project_total_value > 0 then round((company_expense_total / project_total_value * 100)::numeric, 1) else 0 end as expense_ratio
      from base
    ),
    rows_out as materialized (
      select *,
        case when receivables > 0 then 'pending' when receivables < 0 then 'over_collected' else 'settled' end as balance_status,
        case when gross_profit < 0 then 'loss' when gross_margin < 20 then 'low_margin' when gross_margin < 50 then 'healthy' else 'strong' end as profitability_status,
        array_remove(array[
          case when paid_income = 0 then 'no_payments' end,
          case when receivables > 0 then 'pending_receivable' end,
          case when receivables < 0 then 'over_collected' end,
          case when expense_ratio >= 50 then 'high_expense_ratio' end,
          case when gross_profit >= 0 and paid_income > 0 and gross_margin < 20 then 'low_margin' end,
          case when gross_profit < 0 then 'loss_project' end,
          case when project_total_value = 0 then 'no_project_value' end,
          case when company_expense_total = 0 then 'no_linked_expenses' end
        ], null) as attention_flags
      from calc
    )
    select jsonb_build_object(
      'summary', (
        select jsonb_build_object(
          'project_count', count(*),
          'total_project_value', coalesce(sum(project_total_value), 0),
          'total_paid_income', coalesce(sum(paid_income), 0),
          'total_receivables', coalesce(sum(receivables), 0),
          'total_company_expenses', coalesce(sum(company_expense_total), 0),
          'total_gross_profit', coalesce(sum(gross_profit), 0),
          'average_gross_margin', coalesce(round(avg(gross_margin)::numeric, 1), 0),
          'average_collection_rate', coalesce(round(avg(collection_rate)::numeric, 1), 0),
          'loss_project_count', count(*) filter (where profitability_status = 'loss'),
          'pending_project_count', count(*) filter (where balance_status = 'pending'),
          'over_collected_project_count', count(*) filter (where balance_status = 'over_collected')
        ) from rows_out
      ),
      'items', (
        select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
          from (select * from rows_out order by %I %s nulls last limit $8 offset $9) t
      )
    )
  $sql$, v_sort_col, v_sort_dir)
  into v_out
  using v_company, p_date_from, p_date_to, p_project_id, p_client_id, p_status, v_search, v_page_size, (v_page - 1) * v_page_size;

  v_total_count := (v_out->'summary'->>'project_count')::int;

  return jsonb_build_object(
    'summary', v_out->'summary',
    'items', v_out->'items',
    'pagination', jsonb_build_object(
      'page', v_page,
      'page_size', v_page_size,
      'total_count', v_total_count,
      'total_pages', greatest(1, ceil(v_total_count::numeric / v_page_size))
    )
  );
end;
$$;
