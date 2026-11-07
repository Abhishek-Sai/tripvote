-- TripVote: trips and members (SRS section 3.7).
-- Tokens are stored only as hashes. The organizer's token is the token_hash on
-- their member row, where organizer_flag is true.

create table public.trips (
  trip_id    uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  deadline   timestamptz,
  status     text not null default 'open',
  -- Foreign key to destinations is added in the destinations migration.
  winner_id  uuid,

  constraint trips_name_valid
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint trips_status_valid
    check (status in ('open', 'closed', 'tie'))
);

create table public.members (
  member_id      uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips (trip_id) on delete cascade,
  display_name   text not null,
  token_hash     text not null unique,
  organizer_flag boolean not null default false,
  joined_at      timestamptz not null default now(),

  constraint members_display_name_valid
    check (display_name = btrim(display_name) and char_length(display_name) between 1 and 30)
);

-- No two members of a trip may share a name, ignoring letter case.
create unique index members_unique_name_per_trip
  on public.members (trip_id, lower(display_name));

-- A trip has at most one organizer.
create unique index members_one_organizer_per_trip
  on public.members (trip_id)
  where organizer_flag;

-- Only the Express API may touch these tables, using the server key. With RLS on
-- and no policies, Supabase's public browser roles can read and write nothing.
alter table public.trips enable row level security;
alter table public.members enable row level security;

revoke all on public.trips, public.members from anon, authenticated;
grant select, insert, update, delete on public.trips, public.members to service_role;
