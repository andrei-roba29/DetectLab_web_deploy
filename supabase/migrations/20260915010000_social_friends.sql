-- ══════════════════════════════════════════════════════════════════════════
-- DetectLab Social — part 2/4: friends + friend requests
-- ══════════════════════════════════════════════════════════════════════════
--
-- Two tables and a handful of SECURITY DEFINER functions. Every mutation goes
-- through a function on purpose: the quotas agreed in
-- 20260915000000_social_limits_and_directory.sql (1 000 friends, 50 requests
-- per day) must not be bypassable from a browser, and a friendship must never
-- appear out of thin air because a client INSERTed a row.
--
-- Clients therefore get SELECT-only RLS here; INSERT/UPDATE/DELETE have no
-- policy at all, which under RLS means "denied" for authenticated/anon.
--
-- Idempotent: safe to re-run.

-- ── 1. Tables ─────────────────────────────────────────────────────────────

create table if not exists public.friend_requests (
    id             uuid primary key default gen_random_uuid(),
    requester_id   uuid not null references auth.users(id) on delete cascade,
    requester_name text not null default '',
    addressee_id   uuid not null references auth.users(id) on delete cascade,
    addressee_name text not null default '',
    message        text,
    status         text not null default 'pending'
                   check (status in ('pending', 'accepted', 'declined', 'cancelled')),
    created_at     timestamptz not null default now(),
    responded_at   timestamptz,
    constraint friend_requests_not_self check (requester_id <> addressee_id)
);

alter table public.friend_requests
    add column if not exists requester_name text not null default '',
    add column if not exists addressee_name text not null default '',
    add column if not exists responded_at   timestamptz;

create table if not exists public.friendships (
    id         uuid primary key default gen_random_uuid(),
    user_a     uuid not null references auth.users(id) on delete cascade,
    user_b     uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint friendships_not_self check (user_a <> user_b),
    constraint friendships_ordered  check (user_a < user_b)
);

-- One pending request per pair, in either direction: you cannot re-send while
-- a request is open and the other side cannot send a crossing request.
create unique index if not exists friend_requests_pair_pending_uidx
    on public.friend_requests ((least(requester_id, addressee_id)),
                               (greatest(requester_id, addressee_id)))
    where status = 'pending';

create index if not exists friend_requests_addressee_idx
    on public.friend_requests (addressee_id, status, created_at desc);
create index if not exists friend_requests_requester_idx
    on public.friend_requests (requester_id, status, created_at desc);

-- user_a < user_b is enforced by a check constraint, so the plain pair is
-- already unique without an expression index.
create unique index if not exists friendships_pair_uidx
    on public.friendships (user_a, user_b);
create index if not exists friendships_user_b_idx
    on public.friendships (user_b);

-- ── 2. RLS: read your own graph, mutate only through functions ────────────

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

grant select on public.friend_requests to authenticated;
grant select on public.friendships to authenticated;

drop policy if exists "Participants read their friend requests" on public.friend_requests;
create policy "Participants read their friend requests"
    on public.friend_requests for select to authenticated
    using (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists "Friends read their own friendships" on public.friendships;
create policy "Friends read their own friendships"
    on public.friendships for select to authenticated
    using (user_a = auth.uid() or user_b = auth.uid());

-- ── 3. Helpers ────────────────────────────────────────────────────────────

create or replace function public.friendship_count_of(_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
      from public.friendships f
     where f.user_a = _user_id or f.user_b = _user_id;
$$;

create or replace function public.are_friends(_a uuid, _b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.friendships f
         where (f.user_a = _a and f.user_b = _b)
            or (f.user_a = _b and f.user_b = _a)
    );
$$;

grant execute on function public.friendship_count_of(uuid) to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ── 4. Send / cancel / respond ────────────────────────────────────────────

create or replace function public.send_friend_request(_addressee_id uuid, _message text)
returns public.friend_requests
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_limits   public.app_limits%rowtype;
    v_me_row   public.user_social_profiles%rowtype;
    v_them_row public.user_social_profiles%rowtype;
    v_sent_today integer;
    v_row      public.friend_requests%rowtype;
    v_message  text := btrim(coalesce(_message, ''));
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if _addressee_id is null or _addressee_id = v_me then
        raise exception 'CANNOT_ADD_SELF';
    end if;

    select * into v_limits from public.app_limits where id = true;

    select * into v_them_row from public.user_social_profiles where user_id = _addressee_id;
    if not found then
        raise exception 'USER_NOT_FOUND';
    end if;
    if not v_them_row.discoverable then
        raise exception 'USER_NOT_DISCOVERABLE';
    end if;

    select * into v_me_row from public.user_social_profiles where user_id = v_me;
    if not found then
        insert into public.user_social_profiles (user_id, display_name, email)
        values (v_me, '', '')
        returning * into v_me_row;
    end if;

    if public.are_friends(v_me, _addressee_id) then
        raise exception 'ALREADY_FRIENDS';
    end if;

    if exists (
        select 1 from public.friend_requests r
         where r.status = 'pending'
           and ((r.requester_id = v_me and r.addressee_id = _addressee_id)
             or (r.requester_id = _addressee_id and r.addressee_id = v_me))
    ) then
        raise exception 'REQUEST_ALREADY_PENDING';
    end if;

    if public.friendship_count_of(v_me) >= v_limits.max_friends then
        raise exception 'FRIEND_LIMIT_REACHED:%', v_limits.max_friends;
    end if;
    if public.friendship_count_of(_addressee_id) >= v_limits.max_friends then
        raise exception 'ADDRESSEE_FRIEND_LIMIT_REACHED:%', v_limits.max_friends;
    end if;

    select count(*) into v_sent_today
      from public.friend_requests r
     where r.requester_id = v_me
       and r.created_at >= date_trunc('day', now());
    if v_sent_today >= v_limits.max_friend_requests_per_day then
        raise exception 'DAILY_REQUEST_LIMIT_REACHED:%', v_limits.max_friend_requests_per_day;
    end if;

    if length(v_message) > v_limits.max_friend_request_message_len then
        v_message := left(v_message, v_limits.max_friend_request_message_len);
    end if;

    insert into public.friend_requests
        (requester_id, requester_name, addressee_id, addressee_name, message, status)
    values
        (v_me,
         coalesce(nullif(v_me_row.display_name, ''), split_part(v_me_row.email, '@', 1), 'Detectorist'),
         _addressee_id,
         coalesce(nullif(v_them_row.display_name, ''), split_part(v_them_row.email, '@', 1), 'Detectorist'),
         nullif(v_message, ''),
         'pending')
    returning * into v_row;

    return v_row;
exception
    when unique_violation then
        raise exception 'REQUEST_ALREADY_PENDING';
end;
$$;

grant execute on function public.send_friend_request(uuid, text) to authenticated;

create or replace function public.cancel_friend_request(_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    update public.friend_requests
       set status = 'cancelled', responded_at = now()
     where id = _request_id
       and requester_id = v_me
       and status = 'pending';

    if not found then
        raise exception 'REQUEST_NOT_FOUND';
    end if;

    return true;
end;
$$;

grant execute on function public.cancel_friend_request(uuid) to authenticated;

create or replace function public.respond_friend_request(_request_id uuid, _accept boolean)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_req    public.friend_requests%rowtype;
    v_limits public.app_limits%rowtype;
    v_friend public.friendships%rowtype;
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    select * into v_req from public.friend_requests where id = _request_id for update;
    if not found then
        raise exception 'REQUEST_NOT_FOUND';
    end if;
    if v_req.addressee_id <> v_me then
        raise exception 'NOT_YOUR_REQUEST';
    end if;
    if v_req.status <> 'pending' then
        raise exception 'REQUEST_ALREADY_HANDLED:%', v_req.status;
    end if;

    update public.friend_requests
       set status = case when coalesce(_accept, false) then 'accepted' else 'declined' end,
           responded_at = now()
     where id = _request_id;

    if not coalesce(_accept, false) then
        return null;
    end if;

    select * into v_limits from public.app_limits where id = true;

    if public.friendship_count_of(v_me) >= v_limits.max_friends
       or public.friendship_count_of(v_req.requester_id) >= v_limits.max_friends then
        raise exception 'FRIEND_LIMIT_REACHED:%', v_limits.max_friends;
    end if;

    -- Canonical order keeps one row per pair (the check constraint rejects
    -- user_a >= user_b, so sort before inserting).
    insert into public.friendships (user_a, user_b)
    values (least(v_me, v_req.requester_id), greatest(v_me, v_req.requester_id))
    on conflict (user_a, user_b) do update set created_at = public.friendships.created_at
    returning * into v_friend;

    return v_friend;
end;
$$;

grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

create or replace function public.remove_friend(_friend_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    delete from public.friendships
     where (user_a = v_me and user_b = _friend_id)
        or (user_a = _friend_id and user_b = v_me);

    if not found then
        raise exception 'NOT_FRIENDS';
    end if;

    -- Unfriending closes the private conversation: the history stays readable
    -- until the retention job erases it, but neither side can post again
    -- without a new request. Group chats are untouched.
    update public.conversations c
       set status = 'closed'
     where c.kind = 'direct'
       and c.status = 'active'
       and exists (
           select 1
             from public.conversation_members m1
             join public.conversation_members m2
               on m2.conversation_id = m1.conversation_id
            where m1.conversation_id = c.id
              and m1.user_id = v_me
              and m2.user_id = _friend_id
       );

    return true;
end;
$$;

grant execute on function public.remove_friend(uuid) to authenticated;

-- ── 5. Reads used by the Friends panel ────────────────────────────────────

create or replace function public.list_my_friends()
returns table (
    user_id         uuid,
    display_name    text,
    email           text,
    county          text,
    city            text,
    friends_since   timestamptz,
    conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    return query
    select
        case when f.user_a = v_me then f.user_b else f.user_a end as user_id,
        coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1), 'Detectorist') as display_name,
        p.email,
        p.county,
        p.city,
        f.created_at as friends_since,
        (
            select c.id
              from public.conversations c
              join public.conversation_members m1 on m1.conversation_id = c.id and m1.user_id = v_me
              join public.conversation_members m2 on m2.conversation_id = c.id
                   and m2.user_id = case when f.user_a = v_me then f.user_b else f.user_a end
             where c.kind = 'direct'
             order by c.last_message_at desc nulls last, c.created_at desc
             limit 1
        ) as conversation_id
    from public.friendships f
    left join public.user_social_profiles p
           on p.user_id = case when f.user_a = v_me then f.user_b else f.user_a end
    where f.user_a = v_me or f.user_b = v_me
    order by friends_since desc;
end;
$$;

grant execute on function public.list_my_friends() to authenticated;

create or replace function public.list_my_friend_requests(_direction text default 'incoming')
returns table (
    id           uuid,
    direction    text,
    other_id     uuid,
    other_name   text,
    other_email  text,
    other_county text,
    message      text,
    status       text,
    created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    return query
    select
        r.id,
        case when r.addressee_id = v_me then 'incoming'::text else 'outgoing'::text end as direction,
        case when r.addressee_id = v_me then r.requester_id else r.addressee_id end as other_id,
        coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1),
                 case when r.addressee_id = v_me then r.requester_name else r.addressee_name end,
                 'Detectorist') as other_name,
        p.email as other_email,
        p.county as other_county,
        r.message,
        r.status,
        r.created_at
    from public.friend_requests r
    left join public.user_social_profiles p
           on p.user_id = case when r.addressee_id = v_me then r.requester_id else r.addressee_id end
    where (r.requester_id = v_me or r.addressee_id = v_me)
      and (
            coalesce(_direction, 'both') = 'both'
         or (_direction = 'incoming' and r.addressee_id = v_me)
         or (_direction = 'outgoing' and r.requester_id = v_me)
      )
      and (r.status = 'pending' or r.responded_at >= now() - interval '30 days')
    order by (r.status = 'pending') desc, r.created_at desc
    limit 200;
end;
$$;

grant execute on function public.list_my_friend_requests(text) to authenticated;

-- Badge counters for the "Prieteni" menu entry: pending requests + unread
-- chat messages, in one round trip.
create or replace function public.get_social_counters()
returns table (
    pending_requests  integer,
    unread_messages   integer,
    friends           integer,
    conversations     integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        return query select 0, 0, 0, 0;
        return;
    end if;

    return query
    select
        (select count(*)::integer from public.friend_requests r
          where r.addressee_id = v_me and r.status = 'pending') as pending_requests,
        (select count(*)::integer
           from public.conversation_messages cm
           join public.conversation_members m
             on m.conversation_id = cm.conversation_id and m.user_id = v_me
          where cm.sender_id <> v_me
            and cm.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)) as unread_messages,
        public.friendship_count_of(v_me) as friends,
        (select count(*)::integer from public.conversation_members m2
          where m2.user_id = v_me) as conversations;
end;
$$;

grant execute on function public.get_social_counters() to authenticated;
