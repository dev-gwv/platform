-- 0251: how many guests a shoot day expects.
--
-- A studio plans the crew and the cards from the size of the crowd: a haldi
-- for 50 needs one camera, a reception for 800 needs four. The shoot had a
-- date, the hours and the venue but nowhere to write the headcount, so it
-- lived in notes where nothing could read it.
--
-- Optional, a whole number, never negative: a blank means nobody has said yet,
-- which is different from a day with no guests at all.

alter table shoots
  add column if not exists guest_count integer;

alter table shoots drop constraint if exists shoots_guest_count_check;
alter table shoots
  add constraint shoots_guest_count_check
  check (guest_count is null or guest_count between 0 and 100000);
