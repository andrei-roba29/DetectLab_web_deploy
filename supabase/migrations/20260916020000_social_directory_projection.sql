-- ══════════════════════════════════════════════════════════════════════════
-- DetectLab Social — the friends search must actually find people
-- ══════════════════════════════════════════════════════════════════════════
--
-- Follow-up on 20260916010000_social_unified_search.sql. The matching rule was
-- fixed there (case + diacritic folding, substring match, one query for every
-- column), yet the search bar could still answer "no results" to ANY query —
-- for two reasons that have nothing to do with how the text is compared:
--
-- 1. THE DIRECTORY WAS ONLY AS FULL AS THE FRIENDS PANEL WAS USED.
--    search_social_users() reads public.user_social_profiles, and a row in that
--    table is written by upsert_my_social_profile() — which the browser calls
--    when the FRIENDS panel opens. An account that never opened that panel is
--    therefore invisible to the search, even though the app already knows its
--    name, e-mail, city and county from two other tables
--    (user_last_locations, written on every position publish, and
--    detector_presence, written while detection/live location runs). On a
--    young community that means: most people cannot be found at all, which is
--    exactly "nu merge nici cautari complete, nici partiale".
--
--    Fix: mirror those two tables into the directory — a one-time backfill plus
--    triggers, so the directory is a projection of what the app already knows
--    instead of a second opt-in the user has to discover. `discoverable` keeps
--    its meaning: an account that hid itself is never re-exposed, and a mirrored
--    row never overwrites values the user typed in their own profile.
--
-- 2. THE BLANK QUERY MATCHED NOTHING.
--    Tokens are built with regexp_split_to_array(v_q, '\s+'). For an empty
--    string Postgres returns a one-element array containing '', so
--    "cardinality(v_tokens) = 0" was never true, and the per-token test then
--    asked strpos(column, '') > 0 — which is 0, i.e. false. So "browse the
--    whole county" (empty query + county filter, the state the panel is in when
--    it opens) returned an empty list.
--
--    Fix: build the token list from a NULL query instead of an empty string and
--    test it with coalesce(cardinality(…), 0) = 0, so "no words typed" is the
--    "everything in this county" branch again.

-- ── 1. Directory projection: backfill + triggers ──────────────────────────

create or replace function public.mirror_social_profile(
    _user_id uuid,
    _display_name text,
    _email text,
    _county text,
    _city text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if _user_id is null then
        return;
    end if;

    insert into public.user_social_profiles (user_id, display_name, email, county, city)
    values (
        _user_id,
        btrim(coalesce(_display_name, '')),
        lower(btrim(coalesce(_email, ''))),
        nullif(btrim(coalesce(_county, '')), ''),
        nullif(btrim(coalesce(_city, '')), '')
    )
    on conflict (user_id) do update
        -- Only fill what is still empty: the row the owner wrote through
        -- upsert_my_social_profile() always wins over a mirrored guess.
        set display_name = case when btrim(public.user_social_profiles.display_name) = ''
                                then excluded.display_name
                                else public.user_social_profiles.display_name end,
            email        = case when btrim(public.user_social_profiles.email) = ''
                                then excluded.email
                                else public.user_social_profiles.email end,
            county       = coalesce(public.user_social_profiles.county, excluded.county),
            city         = coalesce(public.user_social_profiles.city, excluded.city),
            updated_at   = now()
        -- …and when nothing is missing, do not write at all: the last-location
        -- row this mirror is driven from is re-published on every move, and an
        -- UPDATE per tick would be pure write amplification.
        where btrim(public.user_social_profiles.display_name) = ''
           or btrim(public.user_social_profiles.email) = ''
           or public.user_social_profiles.county is null
           or public.user_social_profiles.city is null;
end;
$$;

-- The mirror writes on the app's behalf, never on a caller's: no public execute.
revoke all on function public.mirror_social_profile(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.mirror_social_profile_from_last_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'UPDATE'
       and row(old.full_name, old.email, old.county, old.city)
           is not distinct from row(new.full_name, new.email, new.county, new.city) then
        return new;          -- a position-only refresh: nothing to mirror
    end if;

    perform public.mirror_social_profile(
        new.user_id, new.full_name, new.email, new.county, new.city);
    return new;
end;
$$;

drop trigger if exists user_last_locations_mirror_social_profile
    on public.user_last_locations;
create trigger user_last_locations_mirror_social_profile
    after insert or update of full_name, email, county, city
    on public.user_last_locations
    for each row execute function public.mirror_social_profile_from_last_location();

-- detector_presence carries the display name + e-mail of a session that is
-- live right now; the county is unknown there, so only the identity is mirrored.
create or replace function public.mirror_social_profile_from_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mirror_social_profile(
        new.user_id, new.full_name, new.email, null, null);
    return new;
end;
$$;

-- INSERT only: detector_presence is upserted on every GPS tick, and a live
-- session registers its identity once — later changes ride along with the
-- (throttled) last-location mirror above.
drop trigger if exists detector_presence_mirror_social_profile
    on public.detector_presence;
create trigger detector_presence_mirror_social_profile
    after insert
    on public.detector_presence
    for each row execute function public.mirror_social_profile_from_presence();

-- One-time backfill, newest row per account winning over the older one.
select public.mirror_social_profile(
    s.user_id, s.display_name, s.email, s.county, s.city)
from (
    select distinct on (user_id) user_id, full_name as display_name, email, county, city
    from public.user_last_locations
    order by user_id, updated_at desc
) s;

select public.mirror_social_profile(
    s.user_id, s.full_name, s.email, null, null)
from (
    select distinct on (user_id) user_id, full_name, email
    from public.detector_presence
    order by user_id, updated_at desc
) s;

-- ── 2. Search: same unified rule, blank query = the whole county ─────────
-- Signature and returned columns are unchanged, so the browser, the grants and
-- the RLS policies keep working untouched.

create or replace function public.search_social_users(
    _query text,
    _county text,
    _limit_n integer default 25
)
returns table (
    user_id      uuid,
    display_name text,
    email        text,
    county       text,
    city         text,
    relationship text,
    request_id   uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_county text := public.normalise_county(_county);
    v_limit  integer := least(greatest(coalesce(_limit_n, 25), 1), 50);
    v_q      text := public.search_normalise(_query);
    -- NULL (not ['']) for "nothing typed": that is what makes the empty query
    -- mean "no text filter" instead of "match the empty substring nowhere".
    v_tokens text[] := case when v_q = '' then null
                            else regexp_split_to_array(v_q, '\s+') end;
begin
    if v_me is null then
        raise exception 'Not signed in';
    end if;

    return query
    select
        p.user_id,
        p.display_name,
        p.email,
        p.county,
        p.city,
        case
            when exists (
                select 1 from public.friendships f
                 where (f.user_a = v_me and f.user_b = p.user_id)
                    or (f.user_a = p.user_id and f.user_b = v_me)
            ) then 'friend'
            when exists (
                select 1 from public.friend_requests r
                 where r.requester_id = v_me and r.addressee_id = p.user_id and r.status = 'pending'
            ) then 'request_sent'
            when exists (
                select 1 from public.friend_requests r
                 where r.requester_id = p.user_id and r.addressee_id = v_me and r.status = 'pending'
            ) then 'request_received'
            else 'none'
        end as relationship,
        (
            select r.id
              from public.friend_requests r
             where r.status = 'pending'
               and ((r.requester_id = v_me and r.addressee_id = p.user_id)
                 or (r.requester_id = p.user_id and r.addressee_id = v_me))
             order by r.created_at desc
             limit 1
        ) as request_id
    from public.user_social_profiles p
    where p.user_id <> v_me
      and (p.discoverable or p.user_id = v_me)
      and (
            v_county is null
         or public.normalise_county(p.county) = v_county
      )
      and (
            -- Blank query: the county filter alone (or the whole directory).
            coalesce(cardinality(v_tokens), 0) = 0
            -- Unified partial match: EVERY query word must appear (substring,
            -- diacritics folded) in at least one visible column.
            or (
                select bool_and(
                    strpos(public.search_normalise(p.display_name), t) > 0
                    or strpos(public.search_normalise(p.email), t) > 0
                    or strpos(public.search_normalise(p.county), t) > 0
                    or strpos(public.search_normalise(p.city), t) > 0
                    or starts_with(lower(p.user_id::text), t)
                )
                from unnest(v_tokens) as t
            )
      )
    order by
        case when v_county is not null and public.normalise_county(p.county) = v_county then 0 else 1 end,
        case when v_q <> '' and starts_with(public.search_normalise(p.display_name), v_q) then 0 else 1 end,
        p.display_name,
        p.email
    limit v_limit;
end;
$$;

grant execute on function public.search_social_users(text, text, integer) to authenticated;
