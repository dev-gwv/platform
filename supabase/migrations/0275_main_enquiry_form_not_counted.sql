-- 0275: a studio's main enquiry form is never stopped by its plan.
--
-- 0274 makes the main form on first open of Enquiry form & QR codes. On a
-- Starter plan that already held its two forms, 0242's enquiry_forms limit
-- refused that insert, so the page answered "We could not load your enquiry
-- form" for that studio alone. The main form is the studio's own, like the
-- sample package: it is not counted and never refused.
--
-- Safe to run twice.

drop trigger if exists enquiry_forms_plan_limit on enquiry_forms;
create trigger enquiry_forms_plan_limit before insert or update of archived_at on enquiry_forms
  for each row when (not new.is_main)
  execute function enforce_plan_limit('enquiry_forms');
