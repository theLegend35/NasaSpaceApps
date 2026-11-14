-- SolaraX Supabase schema (design doc §6b) with row-level security.
-- Run in the Supabase SQL editor. The API writes candidates/labels with the
-- service key; the browser reads and writes its own rows under RLS.

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique,
  orcid_id text,
  orcid_verified boolean not null default false,
  level int not null default 1,
  vote_weight real not null default 0.5,
  classroom_mode boolean not null default false
);
alter table profiles enable row level security;
create policy "profiles readable" on profiles for select using (true);
create policy "update own profile" on profiles for update using (auth.uid() = id)
  with check (auth.uid() = id and orcid_verified = (select orcid_verified from profiles p where p.id = auth.uid())
              and vote_weight = (select vote_weight from profiles p where p.id = auth.uid()));
create policy "insert own profile" on profiles for insert with check (auth.uid() = id and orcid_verified = false);

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  ra double precision not null,
  dec double precision not null,
  field_key text,
  top_class text not null,
  score real not null,
  parts jsonb,
  model_probs jsonb,
  pm_arcsec_yr real,
  status text not null default 'open' check (status in ('open', 'retired', 'disputed', 'confirmed')),
  created_at timestamptz not null default now()
);
alter table candidates enable row level security;
create policy "candidates readable" on candidates for select using (true);
-- no insert/update policy: API only (service key bypasses RLS)

create table if not exists votes (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references candidates on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  answer text not null check (answer in ('matches', 'other', 'artifact', 'cant_tell')),
  other_class text,
  weight real not null default 0.5,
  is_gold boolean not null default false,
  created_at timestamptz not null default now(),
  unique (candidate_id, user_id)
);
alter table votes enable row level security;
create policy "insert own vote" on votes for insert with check (auth.uid() = user_id);
create policy "read own votes" on votes for select using (auth.uid() = user_id);

-- Weight comes from the voter's profile, never from the client.
create or replace function set_vote_weight() returns trigger language plpgsql security definer as $$
begin
  new.weight := coalesce((select vote_weight from profiles where id = new.user_id), 0.5);
  new.is_gold := false;
  return new;
end $$;
drop trigger if exists votes_weight on votes;
create trigger votes_weight before insert on votes for each row execute function set_vote_weight();

-- Public tallies without exposing who voted.
create or replace view candidate_tallies with (security_invoker = false) as
  select candidate_id, answer, sum(weight) as weighted, count(*) as votes from votes group by candidate_id, answer;

create table if not exists labels (
  candidate_id uuid references candidates on delete cascade,
  label text not null,
  source text not null check (source in ('simbad', 'crowd', 'researcher')),
  weight real not null,
  created_at timestamptz not null default now()
);
alter table labels enable row level security; -- API only

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ra double precision not null,
  dec double precision not null,
  fov real,
  view_state jsonb,
  image_path text,
  caption text not null check (char_length(caption) <= 500),
  object_tag text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
alter table posts enable row level security;
create policy "posts readable" on posts for select using (hidden = false or auth.uid() = user_id);
create policy "insert own post" on posts for insert with check (auth.uid() = user_id and hidden = false);
create policy "delete own post" on posts for delete using (auth.uid() = user_id);
create index if not exists posts_dec on posts (dec);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (char_length(body) <= 2000),
  is_ai boolean not null default false,
  created_at timestamptz not null default now()
);
alter table comments enable row level security;
create policy "comments readable" on comments for select using (true);
create policy "insert own comment" on comments for insert with check (auth.uid() = user_id and is_ai = false);
create policy "delete own comment" on comments for delete using (auth.uid() = user_id);

-- Trending = (reactions + comments) / (age in hours + 2)^1.5 (PROPOSAL; no reactions table yet).
create or replace view posts_trending as
  select p.*, (select count(*) from comments c where c.post_id = p.id) as comment_count,
         (select count(*) from comments c where c.post_id = p.id)
           / power(extract(epoch from now() - p.created_at) / 3600.0 + 2, 1.5) as trend
  from posts p where p.hidden = false order by trend desc, created_at desc;

create table if not exists follows (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  target_type text not null check (target_type in ('object', 'region')),
  ra double precision, dec double precision, radius real, object_tag text
);
alter table follows enable row level security;
create policy "own follows" on follows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists reports (
  id bigint generated always as identity primary key,
  post_id uuid references posts on delete cascade,
  comment_id uuid references comments on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
alter table reports enable row level security;
create policy "insert own report" on reports for insert with check (auth.uid() = user_id);

create table if not exists mission_progress (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  mission_id text not null, step int not null, completed_at timestamptz, correct boolean,
  primary key (user_id, mission_id, step)
);
alter table mission_progress enable row level security;
create policy "own progress" on mission_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists tutor_logs (
  id bigint generated always as identity primary key,
  question text, fact_ids text[], model text, dropped int, created_at timestamptz not null default now()
);
alter table tutor_logs enable row level security; -- API only, no personal data

create table if not exists releases (
  collection text primary key, latest_mjd double precision, checked_at timestamptz
);
alter table releases enable row level security;
create policy "releases readable" on releases for select using (true);

-- Storage: create a public bucket named 'posts' for exported GIF/PNGs (Dashboard > Storage).
