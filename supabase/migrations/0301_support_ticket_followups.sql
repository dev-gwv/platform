-- 0301: the support ticket assistant, step 2 (owner, 11 Nov: "add all those").
--
--   * a follow-up message to the studio, drafted by the assistant with the
--     right tutorial links, sent by the owner (a WhatsApp link today; the
--     official API's `support_call_followup` template once it is connected);
--   * a bug's GitHub issue, opened prefilled from the ticket (we only mark it);
--   * tickets that close themselves: the note names one thing the studio
--     should do (make a project, add the team...), and once their data shows
--     it after the call, the ticket is solved by the assistant;
--   * the Monday summary needs no column (its outbox key is its week).
--
-- Service-only like 0300. Safe to run twice.

alter table support_tickets
  add column if not exists watch            text,
  add column if not exists watch_from       timestamptz,
  add column if not exists closed_by        text,
  add column if not exists followup         text,
  add column if not exists followup_sent_at timestamptz,
  add column if not exists followup_via     text,
  add column if not exists issue_opened_at  timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_watch_check') then
    alter table support_tickets add constraint support_tickets_watch_check
      check (watch is null or watch in ('project', 'invoice', 'team', 'lead', 'shoot', 'client', 'gallery', 'plan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_followup_via_check') then
    alter table support_tickets add constraint support_tickets_followup_via_check
      check (followup_via is null or followup_via in ('whatsapp_link', 'official', 'copied'));
  end if;
end $$;

-- The official template for a follow-up, once the WhatsApp API is connected.
alter table platform_settings
  add column if not exists support_wa_tpl_followup text not null default 'support_call_followup';
