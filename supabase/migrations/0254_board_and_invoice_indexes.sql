-- 0254: two indexes the audit found missing.
--
-- A project's invoices (the Billing tab, the client page's money card, the
-- next payment) were found by scanning the studio's invoices: there was an
-- index on (company_id, status, invoice_date) but none on project_id.
--
-- The production board reads a studio's open deliverables; the only indexes
-- were per project, per editor and per shoot, so it read every deliverable
-- the studio ever had. This one covers the board's filter and leaves out
-- finished work, which is most rows in an old studio.
create index if not exists invoices_project_idx
  on invoices (project_id) where project_id is not null;

create index if not exists deliverables_company_open_idx
  on deliverables (company_id, status)
  where status not in ('completed', 'cancelled');
