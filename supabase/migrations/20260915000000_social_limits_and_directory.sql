-- ══════════════════════════════════════════════════════════════════════════
-- DetectLab Social — part 1/4: shared quota table + searchable user directory
-- ══════════════════════════════════════════════════════════════════════════
--
-- The social layer (friends, private/group chat, friend invites to events) is
-- stored PER ACCOUNT in Postgres so a conversation opened on the phone is also
-- there after logging into the same account on a laptop. Because every signed
-- in user can now write messages, the growth has to be bounded: this migration
-- introduces one single source of truth for every quota
-- (`public.app_limits`) that both the DB functions and the browser read, so a
-- limit can be tuned without shipping a new migration.
--
-- Agreed quotas (see FRIENDS_AND_CHAT.md):
--   events ......... max 10 created at once, max 15 attended at once,
--                    deadline at most 365 days in the future
--   messages ....... 2 000 chars, 5 000 per conversation, 90 days retention,
--                    60/minute and 2 000/day per user
--   storage ........ 5 MB per attachment, 200 MB per conversation,
--                    500 MB of chat media per user
--   friends ........ 1 000 friends, 50 requests sent per day
--
-- Idempotent: safe to re-run via `supabase db push` or the SQL editor.

-- ── 1. Quotas ─────────────────────────────────────────────────────────────

create table if not exists public.app_limits (
    id boolean primary key default true,

    -- Events
    max_events_created_active       integer not null default 10,
    max_events_attending_active     integer not null default 15,
    max_event_deadline_days         integer not null default 365,
    max_event_invites_per_event     integer not null default 50,

    -- Friends
    max_friends                     integer not null default 1000,
    max_friend_requests_per_day     integer not null default 50,
    max_friend_request_message_len  integer not null default 200,

    -- Conversations
    max_group_conversations         integer not null default 50,
    max_group_members               integer not null default 100,
    max_conversation_title_len      integer not null default 60,

    -- Messages
    max_message_length              integer not null default 2000,
    max_messages_per_conversation   integer not null default 5000,
    max_messages_per_minute         integer not null default 60,
    max_messages_per_day            integer not null default 2000,
    message_retention_days          integer not null default 90,

    -- Storage (media is stored inline as a data URL, so bytes matter)
    max_attachment_bytes            integer not null default 5242880,     -- 5 MB
    max_conversation_storage_bytes  bigint  not null default 209715200,   -- 200 MB
    max_user_storage_bytes          bigint  not null default 524288000,   -- 500 MB

    -- Event chats reuse the same retention/size philosophy
    event_chat_message_length       integer not null default 2000,

    constraint app_limits_single_row check (id)
);

alter table public.app_limits
    add column if not exists max_events_created_active      integer not null default 10,
    add column if not exists max_events_attending_active    integer not null default 15,
    add column if not exists max_event_deadline_days        integer not null default 365,
    add column if not exists max_event_invites_per_event    integer not null default 50,
    add column if not exists max_friends                    integer not null default 1000,
    add column if not exists max_friend_requests_per_day    integer not null default 50,
    add column if not exists max_friend_request_message_len integer not null default 200,
    add column if not exists max_group_conversations        integer not null default 50,
    add column if not exists max_group_members              integer not null default 100,
    add column if not exists max_conversation_title_len     integer not null default 60,
    add column if not exists max_message_length             integer not null default 2000,
    add column if not exists max_messages_per_conversation  integer not null default 5000,
    add column if not exists max_messages_per_minute        integer not null default 60,
    add column if not exists max_messages_per_day           integer not null default 2000,
    add column if not exists max_attachment_bytes           integer not null default 5242880,
    add column if not exists max_conversation_storage_bytes bigint  not null default 209715200,
    add column if not exists max_user_storage_bytes         bigint  not null default 524288000,
    add column if not exists event_chat_message_length      integer not null default 2000;

-- Exactly one configuration row.
insert into public.app_limits (id) values (true) on conflict (id) do nothing;

alter table public.app_limits enable row level security;
grant select on public.app_limits to authenticated, anon;

-- Everybody may READ the quotas (the UI prints them next to the input fields);
-- only the table owner / service_role may change them, because no write policy
-- exists for authenticated or anon.
drop policy if exists "app_limits readable by everyone" on public.app_limits;
create policy "app_limits readable by everyone"
    on public.app_limits for select to authenticated, anon using (true);

create or replace function public.get_app_limits()
returns public.app_limits
language sql
stable
security definer
set search_path = public
as $$
    select * from public.app_limits where id = true;
$$;

grant execute on function public.get_app_limits() to authenticated, anon;

-- ── 2. County normalisation ───────────────────────────────────────────────
-- Mirrors js/last-location.js normaliseCounty(): "Județul Cluj", "cluj",
-- "CLUJ COUNTY" and "Jud. Cluj" must all compare equal, otherwise the county
-- filter in the Friends panel silently returns nothing.

create or replace function public.normalise_county(raw text)
returns text
language sql
immutable
as $$
    -- lower() first, then fold the Romanian diacritics (ă→a, â→a, î→i, ș→s,
    -- ț→t), then drop the "județul"/"county" noise and collapse spaces.
    select nullif(
        btrim(
            regexp_replace(
                regexp_replace(
                    translate(lower(coalesce(raw, '')), 'ăâîșț', 'aaist'),
                    '(judetul|judet|jud|county|counties|province|voivodeship|region|regiunea|municipiul)',
                    ' ', 'g'),
                '\s+', ' ', 'g')
        ), '');
$$;

-- ── 3. Searchable directory ───────────────────────────────────────────────
-- `user_last_locations` already carries name/e-mail/county, but only for users
-- who allowed location sharing and only after their first fix. The social
-- directory has one row per account (upserted on login) so that search by
-- e-mail / name / id and the county filter always have something to match.

create table if not exists public.user_social_profiles (
    user_id      uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    email        text not null default '',
    county       text,
    city         text,
    discoverable boolean not null default true,
    updated_at   timestamptz not null default now()
);

alter table public.user_social_profiles
    add column if not exists display_name text not null default '',
    add column if not exists email        text not null default '',
    add column if not exists county       text,
    add column if not exists city         text,
    add column if not exists discoverable boolean not null default true,
    add column if not exists updated_at   timestamptz not null default now();

create index if not exists user_social_profiles_email_idx
    on public.user_social_profiles (lower(email));
create index if not exists user_social_profiles_name_idx
    on public.user_social_profiles (lower(display_name));
create index if not exists user_social_profiles_county_idx
    on public.user_social_profiles (public.normalise_county(county));
create index if not exists user_social_profiles_id_text_idx
    on public.user_social_profiles ((user_id::text));
create index if not exists user_social_profiles_discoverable_idx
    on public.user_social_profiles (discoverable);

alter table public.user_social_profiles enable row level security;
grant select, insert, update, delete on public.user_social_profiles to authenticated;

-- Signed-in detectorists may look each other up (that is the point of the
-- Friends search), but hidden accounts stay invisible and writes go through
-- the definer functions below so a client cannot forge somebody else's row.
drop policy if exists "Signed in users read discoverable profiles" on public.user_social_profiles;
create policy "Signed in users read discoverable profiles"
    on public.user_social_profiles for select to authenticated
    using (discoverable or user_id = auth.uid());

drop policy if exists "Users write their own social profile" on public.user_social_profiles;
create policy "Users write their own social profile"
    on public.user_social_profiles for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists "Users update their own social profile" on public.user_social_profiles;
create policy "Users update their own social profile"
    on public.user_social_profiles for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users delete their own social profile" on public.user_social_profiles;
create policy "Users delete their own social profile"
    on public.user_social_profiles for delete to authenticated
    using (user_id = auth.uid());

create or replace function public.upsert_my_social_profile(
    _display_name text,
    _email text,
    _county text,
    _city text
)
returns public.user_social_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.user_social_profiles%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Not signed in';
    end if;

    insert into public.user_social_profiles (user_id, display_name, email, county, city)
    values (
        auth.uid(),
        btrim(coalesce(_display_name, '')),
        lower(btrim(coalesce(_email, ''))),
        nullif(btrim(coalesce(_county, '')), ''),
        nullif(btrim(coalesce(_city, '')), '')
    )
    on conflict (user_id) do update
        set display_name = case
                when btrim(coalesce(_display_name, '')) = ''
                    then public.user_social_profiles.display_name
                else excluded.display_name
            end,
            email = case
                when btrim(coalesce(_email, '')) = ''
                    then public.user_social_profiles.email
                else excluded.email
            end,
            county = coalesce(excluded.county, public.user_social_profiles.county),
            city   = coalesce(excluded.city, public.user_social_profiles.city),
            updated_at = now()
    returning * into v_row;

    return v_row;
end;
$$;

grant execute on function public.upsert_my_social_profile(text, text, text, text) to authenticated;

create or replace function public.set_social_discoverable(_discoverable boolean)
returns public.user_social_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.user_social_profiles%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Not signed in';
    end if;

    update public.user_social_profiles
       set discoverable = coalesce(_discoverable, true),
           updated_at = now()
     where user_id = auth.uid()
    returning * into v_row;

    if not found then
        insert into public.user_social_profiles (user_id, display_name, email, discoverable)
        values (auth.uid(), '', '', coalesce(_discoverable, true))
        returning * into v_row;
    end if;

    return v_row;
end;
$$;

grant execute on function public.set_social_discoverable(boolean) to authenticated;

-- ── 4. Directory search ───────────────────────────────────────────────────
-- One call behind the Friends search bar: matches e-mail, display name or the
-- account id prefix, optionally narrowed to a county, and reports what the
-- caller may do with each hit (already a friend, request pending, …).

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
    v_me       uuid := auth.uid();
    v_query    text := btrim(coalesce(_query, ''));
    v_county   text := public.normalise_county(_county);
    v_limit    integer := least(greatest(coalesce(_limit_n, 25), 1), 50);
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
            v_query = ''
         or lower(p.email) like '%' || lower(v_query) || '%'
         or lower(p.display_name) like '%' || lower(v_query) || '%'
         or p.user_id::text ilike v_query || '%'
      )
    order by
        case when v_county is not null and public.normalise_county(p.county) = v_county then 0 else 1 end,
        case when lower(p.display_name) like lower(v_query) || '%' then 0 else 1 end,
        p.display_name,
        p.email
    limit v_limit;
end;
$$;

grant execute on function public.search_social_users(text, text, integer) to authenticated;

-- Counties that actually have detectorists in them, for the filter dropdown.
create or replace function public.list_social_counties()
returns table (county text, members integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Not signed in';
    end if;

    return query
    select initcap(public.normalise_county(p.county)) as county,
           count(*)::integer as members
      from public.user_social_profiles p
     where public.normalise_county(p.county) is not null
       and (p.discoverable or p.user_id = auth.uid())
     group by public.normalise_county(p.county)
     order by members desc, county;
end;
$$;

grant execute on function public.list_social_counties() to authenticated;
