-- 0233: a person's usual rates beside their full-day rate (freelancer_rate,
-- 0101): a wedding day and a half day (5 hours or less). Assign team fills a
-- booking's payout from them and says which one it used ("Pay ₹10,000 (their
-- wedding rate)"). Pay is sensitive: the API reads and writes these only for
-- people who handle salaries or plan crew, like freelancer_rate.

alter table users add column if not exists rate_wedding_day numeric(12, 2)
  check (rate_wedding_day is null or rate_wedding_day >= 0);
alter table users add column if not exists rate_half_day numeric(12, 2)
  check (rate_half_day is null or rate_half_day >= 0);

comment on column users.rate_wedding_day is 'Usual payout for a wedding day; freelancer_rate is the full-day rate.';
comment on column users.rate_half_day is 'Usual payout for a shoot of 5 hours or less.';
