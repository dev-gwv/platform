-- 0239: the memory cards on a data record, by name.
--
-- A record kept only a count (card_count). Studios label their cards
-- ("SD-04", "CF-2") so a card that goes missing can be traced; the record now
-- keeps those labels too. card_count stays the count everything already
-- reads, and is kept at least as large as the list of labels.

alter table shoot_data_records
  add column if not exists card_labels text[] not null default '{}'
    check (cardinality(card_labels) <= 40);

-- The count follows the labels: three labels are at least three cards. A
-- count with no labels ("2 cards") still stands on its own.
create or replace function shoot_data_records_card_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.card_count := greatest(coalesce(new.card_count, 0), cardinality(coalesce(new.card_labels, '{}')));
  return new;
end;
$$;

drop trigger if exists shoot_data_records_card_count on shoot_data_records;
create trigger shoot_data_records_card_count
  before insert or update of card_count, card_labels on shoot_data_records
  for each row execute function shoot_data_records_card_count();
