-- 0271: support requests (Help → Report a problem / Ask the team).
--
-- Until now "help" was a WhatsApp or email link the person had to send
-- themselves, and the assistant's hand-over ("we will come back to you")
-- reached nobody. A support request is kept here: what the studio wrote, its
-- screenshots (ids in `files`, the studio's own private files), the
-- assistant's conversation when that is where it started, and every reply.
--
-- Our team works them in the shared support Google Sheet (the Frameline
-- desk's Sheet, its "Studio AutoPilot" tab): a new request becomes a row and
-- an email to the platform admins, and a reply written there comes back
-- through POST /webhooks/support-sheet into the request and the studio's bell.
-- lib/support-desk.ts is the one way in and out.
--
-- Reads and writes go through the API with the service role after it has
-- checked who is asking (the person who wrote it, or the studio's owner and
-- admins), so the tables carry RLS with no policy for `authenticated`.

create table if not exists support_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  created_by    uuid references auth.users (id) on delete set null,
  subject       text not null check (char_length(subject) between 1 and 160),
  -- problem: something is not working; question: how do I…; billing: plan or payment; idea: a wish.
  kind          text not null default 'problem' check (kind in ('problem', 'question', 'billing', 'idea')),
  urgency       text not null default 'normal' check (urgency in ('normal', 'high')),
  -- open: waiting for us; answered: we replied; waiting: they wrote again; closed: resolved.
  status        text not null default 'open' check (status in ('open', 'answered', 'waiting', 'closed')),
  page_url      text check (page_url is null or char_length(page_url) <= 500),
  -- The assistant's conversation that led here, for the team (never shown back as ours).
  context       text check (context is null or char_length(context) <= 8000),
  sheet_sent_at timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists support_requests_company_idx on support_requests (company_id, updated_at desc);
create index if not exists support_requests_creator_idx on support_requests (created_by, updated_at desc);
create index if not exists support_requests_open_idx on support_requests (status, created_at) where status <> 'closed';
drop trigger if exists support_requests_set_updated_at on support_requests;
create trigger support_requests_set_updated_at before update on support_requests
  for each row execute function set_updated_at();

create table if not exists support_messages (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references support_requests (id) on delete cascade,
  -- me: someone at the studio; support: our team (from the Sheet).
  sender      text not null check (sender in ('me', 'support')),
  author_uid  uuid references auth.users (id) on delete set null,
  author_name text check (author_name is null or char_length(author_name) <= 120),
  body        text not null check (char_length(body) between 1 and 5000),
  file_ids    uuid[] not null default '{}' check (cardinality(file_ids) <= 5),
  created_at  timestamptz not null default now()
);
create index if not exists support_messages_request_idx on support_messages (request_id, created_at);

alter table support_requests enable row level security;
alter table support_messages enable row level security;
grant select, insert, update, delete on support_requests, support_messages to service_role;

-- The morning summary of open requests goes out once a day.
alter table platform_settings add column if not exists support_digest_on date;

-- Who on our team hears about a new request: each platform admin, at the
-- first active profile of theirs (a bell needs a company to live in).
create or replace function support_team_recipients()
returns table (company_id uuid, user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (pa.user_id) u.company_id, u.user_id, u.email
    from platform_admins pa
    join users u on (u.user_id = pa.user_id or auth_identity_of(u.user_id) = pa.user_id)
   where u.deleted_at is null and u.status = 'active'
   order by pa.user_id, u.created_at
$$;
revoke all on function support_team_recipients() from public, anon, authenticated;
grant execute on function support_team_recipients() to service_role;
