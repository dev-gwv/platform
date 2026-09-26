-- Who may open or remove a stored file.
--
-- `files` rows were readable and deletable by anyone active in the studio
-- (0124): an employee who saw a file id -- in a link, a list, a
-- notification -- could open a colleague's expense receipt or a client's
-- quotation, or delete it. RLS stays company-wide for SELECT (attachment lists
-- and joins read the metadata), but:
--
--   * Deleting a file is for whoever uploaded it, or an owner/admin/manager.
--     Inserting one must name yourself as the uploader.
--   * file_access(id) says, for a file in the caller's studio, who uploaded
--     it and what refers to it -- production work (a voice note on a
--     deliverable or a task), an expense receipt, an invoice attachment,
--     platform feedback. The API decides from that who may download the
--     bytes: the uploader and managers always; anyone for production work;
--     money documents only for people with billing/expense access.

drop policy if exists files_write on files;
drop policy if exists files_insert on files;
drop policy if exists files_delete on files;

create policy files_insert on files
  for insert to authenticated
  with check (company_id = get_current_company_id() and is_current_user_active() and created_by = auth.uid());

create policy files_delete on files
  for delete to authenticated
  using (company_id = get_current_company_id() and is_current_user_active()
         and (created_by = auth.uid() or is_current_admin_or_manager()));

create or replace function file_access(p_file uuid)
returns table (created_by uuid, is_public boolean, kinds text[])
language sql
stable
security definer
set search_path = public
as $$
  select f.created_by, f.is_public,
         array_remove(array[
           case when exists (select 1 from deliverable_notes n where n.file_id = f.id)
                  or exists (select 1 from tasks t
                              where t.company_id = f.company_id
                                and t.voice_note_url like '%/files/' || f.id::text || '%')
                then 'production' end,
           case when exists (select 1 from expense_attachments ea where ea.file_id = f.id) then 'expense' end,
           case when exists (select 1 from invoice_attachments ia where ia.file_id = f.id) then 'invoice' end,
           case when exists (select 1 from feature_requests fr where f.id in (fr.voice_file_id, fr.screenshot_file_id))
                then 'feedback' end
         ], null)
    from files f
   where f.id = p_file and f.company_id = get_current_company_id()
$$;
revoke all on function file_access(uuid) from public, anon;
grant execute on function file_access(uuid) to authenticated, service_role;
