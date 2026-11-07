-- TripVote: destinations, ballots and itinerary items (SRS section 3.7).

-- Lets other tables check that a referenced member belongs to the same trip.
alter table public.members
  add constraint members_member_trip_unique unique (member_id, trip_id);

-- Destinations ---------------------------------------------------------------

create table public.destinations (
  destination_id uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips (trip_id) on delete cascade,
  name           text not null,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now(),

  constraint destinations_name_valid
    check (name = btrim(name) and char_length(name) between 1 and 60),
  constraint destinations_note_valid
    check (note is null or char_length(note) <= 2000),
  constraint destinations_destination_trip_unique unique (destination_id, trip_id),
  -- The creator must be a member of the same trip; cleared if they are removed.
  constraint destinations_created_by_fkey
    foreign key (created_by, trip_id) references public.members (member_id, trip_id)
    on delete set null (created_by)
);

-- FR-06: no duplicate names in a trip, ignoring letter case.
create unique index destinations_unique_name_per_trip
  on public.destinations (trip_id, lower(name));

-- The winner must be a destination of the same trip.
alter table public.trips
  add constraint trips_winner_fkey
    foreign key (winner_id, trip_id) references public.destinations (destination_id, trip_id)
    on delete set null (winner_id);

-- Ballots --------------------------------------------------------------------

create function public.has_no_duplicates(ids uuid[])
  returns boolean
  language sql
  immutable
as $$
  select cardinality(ids) = (select count(distinct id) from unnest(ids) as id)
$$;

create table public.ballots (
  ballot_id               uuid primary key default gen_random_uuid(),
  trip_id                 uuid not null,
  member_id               uuid not null,
  -- Rank 1 first. The API checks each id is a destination of this trip (FR-08).
  ordered_destination_ids uuid[] not null,
  submitted_at            timestamptz not null default now(),

  -- SEC-03 / NFR-02: one active ballot per member per trip.
  constraint ballots_one_per_member unique (trip_id, member_id),
  -- FR-20: removing a member discards their ballot.
  constraint ballots_member_fkey
    foreign key (member_id, trip_id) references public.members (member_id, trip_id)
    on delete cascade,
  constraint ballots_ranking_valid
    check (cardinality(ordered_destination_ids) >= 1
           and public.has_no_duplicates(ordered_destination_ids))
);

-- When a destination is removed, drop it from every ballot so later ranks move
-- up, and delete ballots that ranked nothing else.
create function public.remove_destination_from_ballots()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  delete from public.ballots
   where trip_id = old.trip_id
     and ordered_destination_ids = array[old.destination_id];

  update public.ballots
     set ordered_destination_ids = array_remove(ordered_destination_ids, old.destination_id)
   where trip_id = old.trip_id
     and old.destination_id = any (ordered_destination_ids);

  return old;
end;
$$;

create trigger destinations_remove_from_ballots
  before delete on public.destinations
  for each row execute function public.remove_destination_from_ballots();

-- Itinerary items ------------------------------------------------------------

create table public.itinerary_items (
  item_id     uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (trip_id) on delete cascade,
  title       text not null,
  -- Date and start time (FR-22), stored in UTC and shown in the viewer's time zone.
  starts_at   timestamptz not null,
  description text,
  -- ADR-001: optimistic concurrency. Edits must send the current version.
  version     integer not null default 1,
  created_by  uuid,
  updated_at  timestamptz not null default now(),

  constraint itinerary_items_title_valid
    check (title = btrim(title) and char_length(title) between 1 and 100),
  constraint itinerary_items_description_valid
    check (description is null or char_length(description) <= 500),
  constraint itinerary_items_version_valid
    check (version >= 1),
  constraint itinerary_items_created_by_fkey
    foreign key (created_by, trip_id) references public.members (member_id, trip_id)
    on delete set null (created_by)
);

create index itinerary_items_trip_starts_at
  on public.itinerary_items (trip_id, starts_at);

-- Access: API only -----------------------------------------------------------

alter table public.destinations enable row level security;
alter table public.ballots enable row level security;
alter table public.itinerary_items enable row level security;

revoke all on public.destinations, public.ballots, public.itinerary_items
  from anon, authenticated;
grant select, insert, update, delete
  on public.destinations, public.ballots, public.itinerary_items to service_role;

revoke execute on function public.has_no_duplicates(uuid[]) from public, anon, authenticated;
-- The ballots check constraint calls this as the API's role.
grant execute on function public.has_no_duplicates(uuid[]) to service_role;
revoke execute on function public.remove_destination_from_ballots() from public, anon, authenticated;
