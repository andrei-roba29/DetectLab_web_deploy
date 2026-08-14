-- Anonymous events: hidden from the public map, joinable instantly via a share code.
--
-- * is_anonymous  – when true the event never renders on the map for users who
--                   are not the creator or a joined attendee. For those users
--                   the marker renders with the same helmet symbol, translucent.
-- * event_code    – short share code (e.g. "K7KQ4D") typed into the
--                   "Join an anonymous event" bar in the Events panel.
--                   Joining via code requires NO inquiry/approval: the user is
--                   added to event_attendees directly and the creator receives
--                   a notification.

alter table public.events
    add column if not exists is_anonymous boolean not null default false,
    add column if not exists event_code text;

-- One event per code (codes are only set for anonymous events).
create unique index if not exists events_event_code_unique_idx
    on public.events (event_code)
    where event_code is not null;

-- Fast lookup when a user joins by code.
create index if not exists events_event_code_idx
    on public.events (event_code);
