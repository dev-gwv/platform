-- 0273: written support requests are gone; Book a call is the way to a person.
--
-- 0271 kept support requests (Help → Tell the team, Your requests, replies from
-- a Google Sheet). The owner chose the booking link instead (19 Oct): Help, the
-- assistant's hand-over, Plan & billing and Getting started open the call link
-- (`platform_settings.support_call_url`, 0272), and the booking app takes it
-- from there. Nothing reads these any more. Safe to run twice.

drop function if exists support_team_recipients();
drop table if exists support_messages;
drop table if exists support_requests;
alter table platform_settings drop column if exists support_digest_on;
