import type { TransactionSql } from 'postgres'

/**
 * A deliverable as its editor sees it, shared by My work and the project page
 * a team member opens: what, for whom, by when, the shoots it is made from
 * (with whether their data is in), where that data is, and who gave it out.
 *
 * Data counts as in once a copy is made (copied, backed up, verified,
 * archived). `done` > 0 also returns what was delivered or dropped in the
 * last that-many days.
 */
export function selectMyDeliverables(
  sql: TransactionSql,
  o: { companyId: string; userId: string; projectId?: string | null; done?: number },
) {
  const done = Math.max(0, Math.min(o.done ?? 0, 60))
  return sql`
    with mine as (
      select d.*,
             coalesce(
               (select array_agg(l.shoot_id) from deliverable_shoot_links l where l.deliverable_id = d.id),
               case when d.shoot_id is null then '{}'::uuid[] else array[d.shoot_id] end
             ) as shoot_ids
        from deliverables d
       where d.assignee_id = ${o.userId}
         and d.company_id = ${o.companyId}
         and ${o.projectId ? sql`d.project_id = ${o.projectId}` : sql`true`}
         and (d.status not in ('completed', 'cancelled')
              or (${done} > 0 and coalesce(d.delivered_at, d.updated_at) > now() - make_interval(days => ${done})))
    )
    select d.id, d.project_id, p.name as project_name, cl.name as client_name,
           d.title, d.description, d.status, d.estimated_date, s.name as shoot_name,
           d.delivery_link, d.visibility_scope, d.custom_status_code,
           (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind <> 'event') as notes_count,
           (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind = 'voice') as voice_count,
           -- The studio's own work days for this name, when it has set them (0179).
           company_start_by(${o.companyId}::uuid, d.estimated_date, d.title, d.delivery_days_after_start) as start_by,
           company_work_days(${o.companyId}::uuid, d.title, d.delivery_days_after_start) as work_days,
           d.started_at,
           coalesce(rv.changes_requested, false) as changes_requested, rv.review_note, rv.last_version,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', sh.id, 'name', sh.name, 'shoot_date', sh.shoot_date,
                      'data_ready', exists (
                        select 1 from shoot_data_records r
                         where r.shoot_id = sh.id
                           and r.data_status in ('copied', 'backed_up', 'verified', 'archived')))
                    order by sh.shoot_date nulls last, sh.name)
               from shoots sh where sh.id = any (d.shoot_ids)
           ), '[]'::jsonb) as shoots,
           (select concat_ws(' · ', nullif(btrim(sl.name), ''), nullif(btrim(r.folder_path), ''),
                             case when sl.name is null and nullif(btrim(r.folder_path), '') is null
                                  then nullif(btrim(r.cloud_link), '') end)
              from shoot_data_records r
              left join storage_locations sl on sl.id = r.primary_location_id
             where r.shoot_id = any (d.shoot_ids)
               and r.data_status in ('copied', 'backed_up', 'verified', 'archived')
             order by r.created_at
             limit 1) as data_where,
           ab.name as assigned_by_name,
           (select jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'file_id', n.file_id,
                                      'duration_seconds', n.duration_seconds, 'author_name', au.name,
                                      'created_at', n.created_at)
              from deliverable_notes n
              left join users au on au.user_id = n.author_id and au.company_id = n.company_id
             where n.deliverable_id = d.id and n.kind in ('text', 'voice')
               and n.author_id is distinct from ${o.userId}::uuid
             order by n.created_at desc
             limit 1) as last_note,
           (select count(*)::int from notifications nt
             where nt.company_id = d.company_id and nt.recipient_uid = ${o.userId}::uuid
               and nt.type = 'deliverable_note' and nt.entity_type = 'deliverable'
               and nt.entity_id = d.id and nt.read_at is null) as unread_notes,
           case when d.status in ('completed', 'cancelled') then coalesce(d.delivered_at, d.updated_at) end as done_at
      from mine d
      join projects p on p.id = d.project_id
      left join clients cl on cl.id = p.client_id
      left join shoots s on s.id = d.shoot_id
      left join users ab on ab.user_id = d.assigned_by and ab.company_id = d.company_id
      left join lateral deliverable_revision_state(d.id) rv on true
     order by (d.status in ('completed', 'cancelled')), d.estimated_date nulls last, d.created_at
     limit 200`
}
