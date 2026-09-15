-- ══════════════════════════════════════════════════════════════════════════
-- DetectLab Social — part 3/4: private + group conversations
-- ══════════════════════════════════════════════════════════════════════════
--
-- A conversation is either `direct` (exactly two friends) or `group` (a title
-- and up to `max_group_members` friends, created by an admin). Messages live
-- in Postgres, scoped to the ACCOUNT — not to the device — so signing into the
-- same account elsewhere shows the same threads. The browser keeps an
-- additional per-account cache (js/friends.js) for offline reads.
--
-- Every write goes through a SECURITY DEFINER function that enforces the
-- quotas from public.app_limits:
--   • membership         — only members read/post, only friends can be added
--   • message length     — 2 000 characters
--   • rate               — 60 messages/minute, 2 000/day per user
--   • per-thread volume  — 5 000 messages, 200 MB of media
--   • per-account volume — 500 MB of chat media
--   • retention          — 90 days, trimmed by cleanup_social_messages()
-- When a thread exceeds its volume the OLDEST messages are dropped first, so
-- the conversation keeps working instead of refusing new messages forever.
--
-- Idempotent: safe to re-run.

-- ── 1. Tables ─────────────────────────────────────────────────────────────

create table if not exists public.conversations (
    id              uuid primary key default gen_random_uuid(),
    kind            text not null default 'direct' check (kind in ('direct', 'group')),
    title           text,
    status          text not null default 'active' check (status in ('active', 'closed')),
    created_by      uuid not null references auth.users(id) on delete cascade,
    created_at      timestamptz not null default now(),
    last_message_at timestamptz,
    message_count   integer not null default 0,
    storage_bytes   bigint  not null default 0
);

alter table public.conversations
    add column if not exists status          text not null default 'active',
    add column if not exists last_message_at timestamptz,
    add column if not exists message_count   integer not null default 0,
    add column if not exists storage_bytes   bigint  not null default 0;

-- Re-assert the value constraints in case the tables predate this migration.
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('direct', 'group'));
alter table public.conversations drop constraint if exists conversations_status_check;
alter table public.conversations add constraint conversations_status_check check (status in ('active', 'closed'));

create table if not exists public.conversation_members (
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    user_id         uuid not null references auth.users(id) on delete cascade,
    role            text not null default 'member' check (role in ('admin', 'member')),
    joined_at       timestamptz not null default now(),
    last_read_at    timestamptz,
    primary key (conversation_id, user_id)
);

alter table public.conversation_members
    add column if not exists role         text not null default 'member',
    add column if not exists joined_at    timestamptz not null default now(),
    add column if not exists last_read_at timestamptz;

alter table public.conversation_members drop constraint if exists conversation_members_role_check;
alter table public.conversation_members add constraint conversation_members_role_check check (role in ('admin', 'member'));

create table if not exists public.conversation_messages (
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    id              uuid not null default gen_random_uuid(),
    sender_id       uuid not null references auth.users(id) on delete cascade,
    sender_name     text not null default '',
    body            text,
    media_url       text,
    media_type      text not null default 'none' check (media_type in ('none', 'image', 'video')),
    media_bytes     integer not null default 0,
    created_at      timestamptz not null default now(),
    primary key (conversation_id, id)
);

alter table public.conversation_messages
    add column if not exists sender_name text not null default '',
    add column if not exists media_bytes integer not null default 0;

alter table public.conversation_messages drop constraint if exists conversation_messages_media_type_check;
alter table public.conversation_messages add constraint conversation_messages_media_type_check check (media_type in ('none', 'image', 'video'));

create index if not exists conversation_messages_created_idx
    on public.conversation_messages (conversation_id, created_at desc, id desc);
create index if not exists conversation_messages_sender_idx
    on public.conversation_messages (sender_id, created_at desc);
create index if not exists conversation_members_user_idx
    on public.conversation_members (user_id);
create index if not exists conversations_status_last_message_idx
    on public.conversations (status, last_message_at desc);

-- ── 2. RLS: members only, writes through functions ────────────────────────

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_messages enable row level security;

grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select on public.conversation_messages to authenticated;

drop policy if exists "Members read their conversations" on public.conversations;
create policy "Members read their conversations"
    on public.conversations for select to authenticated
    using (exists (
        select 1 from public.conversation_members m
         where m.conversation_id = conversations.id and m.user_id = auth.uid()
    ));

drop policy if exists "Members read conversation members" on public.conversation_members;
create policy "Members read conversation members"
    on public.conversation_members for select to authenticated
    using (exists (
        select 1 from public.conversation_members mm
         where mm.conversation_id = conversation_members.conversation_id
           and mm.user_id = auth.uid()
    ));

drop policy if exists "Members read conversation messages" on public.conversation_messages;
create policy "Members read conversation messages"
    on public.conversation_messages for select to authenticated
    using (exists (
        select 1 from public.conversation_members m
         where m.conversation_id = conversation_messages.conversation_id
           and m.user_id = auth.uid()
    ));

-- Live updates for open threads (same publication the event chat uses).
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
            select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public'
               and tablename = 'conversation_messages'
       ) then
        alter publication supabase_realtime add table public.conversation_messages;
    end if;
end
$$;

-- ── 3. Membership helpers ─────────────────────────────────────────────────

create or replace function public.is_conversation_member(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.conversation_members m
         where m.conversation_id = _conversation_id and m.user_id = _user_id
    );
$$;

create or replace function public.my_conversation_role(_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select m.role from public.conversation_members m
     where m.conversation_id = _conversation_id and m.user_id = auth.uid();
$$;

grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.my_conversation_role(uuid) to authenticated;

-- ── 4. Direct conversations ───────────────────────────────────────────────

create or replace function public.start_direct_conversation(_other_user uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me   uuid := auth.uid();
    v_conv public.conversations%rowtype;
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if _other_user is null or _other_user = v_me then
        raise exception 'INVALID_TARGET';
    end if;
    if not public.are_friends(v_me, _other_user) then
        raise exception 'NOT_FRIENDS';
    end if;

    select c.* into v_conv
      from public.conversations c
      join public.conversation_members m1 on m1.conversation_id = c.id and m1.user_id = v_me
      join public.conversation_members m2 on m2.conversation_id = c.id and m2.user_id = _other_user
     where c.kind = 'direct'
     order by c.last_message_at desc nulls last, c.created_at desc
     limit 1;

    if found then
        -- Re-opening an unfriended/refriended thread keeps the old history.
        update public.conversations set status = 'active' where id = v_conv.id;
        select * into v_conv from public.conversations where id = v_conv.id;
        return v_conv;
    end if;

    insert into public.conversations (kind, title, created_by, status)
    values ('direct', null, v_me, 'active')
    returning * into v_conv;

    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_conv.id, v_me, 'member'), (v_conv.id, _other_user, 'member')
    on conflict (conversation_id, user_id) do nothing;

    return v_conv;
end;
$$;

grant execute on function public.start_direct_conversation(uuid) to authenticated;

-- ── 5. Group conversations ────────────────────────────────────────────────

create or replace function public.create_group_conversation(_title text, _member_ids uuid[])
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_limits  public.app_limits%rowtype;
    v_title   text := btrim(coalesce(_title, ''));
    v_members uuid[];
    v_conv    public.conversations%rowtype;
    v_groups  integer;
    v_id      uuid;
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    select * into v_limits from public.app_limits where id = true;

    if v_title = '' then
        raise exception 'TITLE_REQUIRED';
    end if;
    if length(v_title) > v_limits.max_conversation_title_len then
        v_title := left(v_title, v_limits.max_conversation_title_len);
    end if;

    select coalesce(array_agg(distinct u), '{}') into v_members
      from unnest(coalesce(_member_ids, '{}')) as u
     where u is not null and u <> v_me;

    if array_length(v_members, 1) is null then
        raise exception 'NO_MEMBERS_SELECTED';
    end if;
    if array_length(v_members, 1) + 1 > v_limits.max_group_members then
        raise exception 'GROUP_TOO_LARGE:%', v_limits.max_group_members;
    end if;

    -- Everybody invited must already be a friend of the creator; that is what
    -- keeps group chat from becoming a broadcast/spam tool.
    if exists (
        select 1 from unnest(v_members) as m(user_id)
         where not public.are_friends(v_me, m.user_id)
    ) then
        raise exception 'NOT_FRIENDS';
    end if;

    select count(*) into v_groups
      from public.conversations c
      join public.conversation_members mm on mm.conversation_id = c.id
     where mm.user_id = v_me and c.kind = 'group' and c.status = 'active';
    if v_groups >= v_limits.max_group_conversations then
        raise exception 'GROUP_LIMIT_REACHED:%', v_limits.max_group_conversations;
    end if;

    insert into public.conversations (kind, title, created_by, status)
    values ('group', v_title, v_me, 'active')
    returning * into v_conv;

    -- The creator is the admin: only they rename the group, invite more
    -- friends, remove members or delete the group.
    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_conv.id, v_me, 'admin');

    foreach v_id in array v_members loop
        insert into public.conversation_members (conversation_id, user_id, role)
        values (v_conv.id, v_id, 'member')
        on conflict (conversation_id, user_id) do nothing;
    end loop;

    return v_conv;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

create or replace function public.rename_conversation(_conversation_id uuid, _title text)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limits public.app_limits%rowtype;
    v_title  text := btrim(coalesce(_title, ''));
    v_conv   public.conversations%rowtype;
begin
    if auth.uid() is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if public.my_conversation_role(_conversation_id) is distinct from 'admin' then
        raise exception 'ADMIN_ONLY';
    end if;

    select * into v_limits from public.app_limits where id = true;
    if v_title = '' then
        raise exception 'TITLE_REQUIRED';
    end if;
    v_title := left(v_title, v_limits.max_conversation_title_len);

    update public.conversations
       set title = v_title
     where id = _conversation_id and kind = 'group'
    returning * into v_conv;

    if not found then
        raise exception 'CONVERSATION_NOT_FOUND';
    end if;
    return v_conv;
end;
$$;

grant execute on function public.rename_conversation(uuid, text) to authenticated;

create or replace function public.add_conversation_members(_conversation_id uuid, _member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_limits  public.app_limits%rowtype;
    v_members uuid[];
    v_conv    public.conversations%rowtype;
    v_current integer;
    v_id      uuid;
    v_added   integer := 0;
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if public.my_conversation_role(_conversation_id) is distinct from 'admin' then
        raise exception 'ADMIN_ONLY';
    end if;

    select * into v_conv from public.conversations where id = _conversation_id;
    if not found then
        raise exception 'CONVERSATION_NOT_FOUND';
    end if;
    if v_conv.kind <> 'group' then
        raise exception 'DIRECT_CONVERSATION_FIXED';
    end if;

    select * into v_limits from public.app_limits where id = true;

    select coalesce(array_agg(distinct u), '{}') into v_members
      from unnest(coalesce(_member_ids, '{}')) as u
     where u is not null and u <> v_me;

    if array_length(v_members, 1) is null then
        raise exception 'NO_MEMBERS_SELECTED';
    end if;
    if exists (
        select 1 from unnest(v_members) as m(user_id)
         where not public.are_friends(v_me, m.user_id)
    ) then
        raise exception 'NOT_FRIENDS';
    end if;

    select count(*) into v_current from public.conversation_members
     where conversation_id = _conversation_id;
    if v_current + array_length(v_members, 1) > v_limits.max_group_members then
        raise exception 'GROUP_TOO_LARGE:%', v_limits.max_group_members;
    end if;

    foreach v_id in array v_members loop
        insert into public.conversation_members (conversation_id, user_id, role)
        values (_conversation_id, v_id, 'member')
        on conflict (conversation_id, user_id) do nothing;
        if found then
            v_added := v_added + 1;
        end if;
    end loop;

    return v_added;
end;
$$;

grant execute on function public.add_conversation_members(uuid, uuid[]) to authenticated;

create or replace function public.remove_conversation_member(_conversation_id uuid, _user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_conv   public.conversations%rowtype;
    v_admins integer;
begin
    if auth.uid() is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if public.my_conversation_role(_conversation_id) is distinct from 'admin' then
        raise exception 'ADMIN_ONLY';
    end if;

    select * into v_conv from public.conversations where id = _conversation_id;
    if not found then
        raise exception 'CONVERSATION_NOT_FOUND';
    end if;
    if v_conv.kind <> 'group' then
        raise exception 'DIRECT_CONVERSATION_FIXED';
    end if;
    if _user_id = auth.uid() then
        raise exception 'USE_LEAVE_INSTEAD';
    end if;

    select count(*) into v_admins from public.conversation_members
     where conversation_id = _conversation_id and role = 'admin';
    if v_admins <= 1 and exists (
        select 1 from public.conversation_members
         where conversation_id = _conversation_id and user_id = _user_id and role = 'admin'
    ) then
        raise exception 'LAST_ADMIN';
    end if;

    delete from public.conversation_members
     where conversation_id = _conversation_id and user_id = _user_id;

    if not found then
        raise exception 'MEMBER_NOT_FOUND';
    end if;
    return true;
end;
$$;

grant execute on function public.remove_conversation_member(uuid, uuid) to authenticated;

create or replace function public.leave_conversation(_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me   uuid := auth.uid();
    v_conv public.conversations%rowtype;
    v_next uuid;
    v_left integer;
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if not public.is_conversation_member(_conversation_id, v_me) then
        raise exception 'NOT_A_MEMBER';
    end if;

    select * into v_conv from public.conversations where id = _conversation_id;

    if v_conv.kind = 'direct' then
        -- A private thread cannot be left half-way: it is closed for both
        -- sides and its history ages out with the retention job.
        update public.conversations set status = 'closed' where id = _conversation_id;
        return true;
    end if;

    delete from public.conversation_members
     where conversation_id = _conversation_id and user_id = v_me;

    select count(*) into v_left from public.conversation_members
     where conversation_id = _conversation_id;

    if v_left = 0 then
        delete from public.conversations where id = _conversation_id;
        return true;
    end if;

    -- Never leave a group without an admin.
    if not exists (
        select 1 from public.conversation_members
         where conversation_id = _conversation_id and role = 'admin'
    ) then
        select m.user_id into v_next
          from public.conversation_members m
         where m.conversation_id = _conversation_id
         order by m.joined_at, m.user_id
         limit 1;
        if v_next is not null then
            update public.conversation_members
               set role = 'admin'
             where conversation_id = _conversation_id and user_id = v_next;
        end if;
    end if;

    return true;
end;
$$;

grant execute on function public.leave_conversation(uuid) to authenticated;

create or replace function public.delete_conversation(_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_conv public.conversations%rowtype;
begin
    if auth.uid() is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if public.my_conversation_role(_conversation_id) is distinct from 'admin' then
        raise exception 'ADMIN_ONLY';
    end if;

    select * into v_conv from public.conversations where id = _conversation_id;
    if not found then
        raise exception 'CONVERSATION_NOT_FOUND';
    end if;
    if v_conv.kind <> 'group' then
        raise exception 'DIRECT_CONVERSATION_FIXED';
    end if;

    -- Members and messages cascade with the conversation row.
    delete from public.conversations where id = _conversation_id;
    return true;
end;
$$;

grant execute on function public.delete_conversation(uuid) to authenticated;

create or replace function public.mark_conversation_read(_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    update public.conversation_members
       set last_read_at = now()
     where conversation_id = _conversation_id
       and user_id = auth.uid();

    if not found then
        raise exception 'NOT_A_MEMBER';
    end if;

    return now();
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ── 6. Sending a message (all volume/rate limits live here) ───────────────

create or replace function public.send_conversation_message(
    _conversation_id uuid,
    _body text,
    _media_url text,
    _media_type text,
    _media_bytes integer
)
returns public.conversation_messages
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_limits   public.app_limits%rowtype;
    v_conv     public.conversations%rowtype;
    v_profile  public.user_social_profiles%rowtype;
    v_body     text := coalesce(_body, '');
    v_type     text := lower(coalesce(nullif(btrim(_media_type), ''), 'none'));
    v_bytes    integer;
    v_per_min  integer;
    v_per_day  integer;
    v_row      public.conversation_messages%rowtype;
    v_trimmed  boolean := false;
    v_freed    bigint;
    v_actual_bytes bigint;
    v_failsafe integer := 0;
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if not public.is_conversation_member(_conversation_id, v_me) then
        raise exception 'NOT_A_MEMBER';
    end if;

    select * into v_conv from public.conversations where id = _conversation_id;
    if v_conv.status <> 'active' then
        raise exception 'CONVERSATION_CLOSED';
    end if;

    select * into v_limits from public.app_limits where id = true;

    if v_type not in ('none', 'image', 'video') then
        raise exception 'UNSUPPORTED_MEDIA_TYPE';
    end if;
    if length(v_body) > v_limits.max_message_length then
        raise exception 'MESSAGE_TOO_LONG:%', v_limits.max_message_length;
    end if;

    -- Base64 media is stored inline, so the real cost is the stored payload,
    -- not the number the browser reported. Take whichever is bigger.
    v_bytes := greatest(coalesce(_media_bytes, 0), octet_length(coalesce(_media_url, '')));
    if v_bytes > v_limits.max_attachment_bytes then
        raise exception 'ATTACHMENT_TOO_LARGE:%', v_limits.max_attachment_bytes;
    end if;
    if btrim(v_body) = '' and v_type = 'none' then
        raise exception 'EMPTY_MESSAGE';
    end if;

    -- Rate limiting (indexed on sender_id + created_at).
    select count(*) into v_per_min
      from public.conversation_messages
     where sender_id = v_me and created_at >= now() - interval '1 minute';
    if v_per_min >= v_limits.max_messages_per_minute then
        raise exception 'RATE_LIMIT_MINUTE:%', v_limits.max_messages_per_minute;
    end if;

    select count(*) into v_per_day
      from public.conversation_messages
     where sender_id = v_me and created_at >= date_trunc('day', now());
    if v_per_day >= v_limits.max_messages_per_day then
        raise exception 'RATE_LIMIT_DAY:%', v_limits.max_messages_per_day;
    end if;

    -- Thread volume: free room by dropping the oldest messages first.
    if v_conv.message_count >= v_limits.max_messages_per_conversation then
        delete from public.conversation_messages
         where conversation_id = _conversation_id
           and id in (
                select id from public.conversation_messages
                 where conversation_id = _conversation_id
                 order by created_at, id
                 limit greatest(v_conv.message_count - v_limits.max_messages_per_conversation + 1, 1)
           );
        v_trimmed := true;
    end if;

    while (v_conv.storage_bytes + v_bytes) > v_limits.max_conversation_storage_bytes
          and v_failsafe < 500 loop
        with victim as (
            select id, media_bytes
              from public.conversation_messages
             where conversation_id = _conversation_id and media_bytes > 0
             order by created_at, id
             limit 1
        ), gone as (
            delete from public.conversation_messages
             where conversation_id = _conversation_id
               and id = (select id from victim)
            returning media_bytes
        )
        select coalesce(sum(gone.media_bytes), 0) into v_freed from gone;

        if coalesce(v_freed, 0) = 0 then
            exit;
        end if;
        v_conv.storage_bytes := greatest(v_conv.storage_bytes - v_freed, 0);
        v_trimmed := true;
        v_failsafe := v_failsafe + 1;
    end loop;

    if (v_conv.storage_bytes + v_bytes) > v_limits.max_conversation_storage_bytes then
        -- The counter may simply have drifted (messages deleted by the
        -- retention job before it recomputed it). Trust the real rows before
        -- refusing the message, otherwise a thread could lock up forever.
        select coalesce(sum(cm.media_bytes), 0)::bigint into v_actual_bytes
          from public.conversation_messages cm
         where cm.conversation_id = _conversation_id;
        v_conv.storage_bytes := v_actual_bytes;
        v_trimmed := true;
    end if;

    if (v_conv.storage_bytes + v_bytes) > v_limits.max_conversation_storage_bytes then
        raise exception 'CONVERSATION_STORAGE_FULL:%', v_limits.max_conversation_storage_bytes;
    end if;

    -- Per-account volume across every thread this user belongs to.
    if (
        select coalesce(sum(c.storage_bytes), 0)
          from public.conversations c
          join public.conversation_members m on m.conversation_id = c.id
         where m.user_id = v_me
       ) + v_bytes > v_limits.max_user_storage_bytes then
        raise exception 'USER_STORAGE_FULL:%', v_limits.max_user_storage_bytes;
    end if;

    select * into v_profile from public.user_social_profiles where user_id = v_me;

    insert into public.conversation_messages
        (conversation_id, sender_id, sender_name, body, media_url, media_type, media_bytes)
    values
        (_conversation_id, v_me,
         coalesce(nullif(v_profile.display_name, ''), split_part(v_profile.email, '@', 1), 'Detectorist'),
         nullif(v_body, ''),
         case when v_type = 'none' then null else _media_url end,
         v_type,
         case when v_type = 'none' then 0 else v_bytes end)
    returning * into v_row;

    if v_trimmed then
        update public.conversations c
           set last_message_at = v_row.created_at,
               message_count = (select count(*)::integer from public.conversation_messages
                                 where conversation_id = c.id),
               storage_bytes = (select coalesce(sum(media_bytes), 0)::bigint from public.conversation_messages
                                 where conversation_id = c.id)
         where c.id = _conversation_id;
    else
        update public.conversations
           set last_message_at = v_row.created_at,
               message_count = message_count + 1,
               storage_bytes = storage_bytes + (v_row.media_bytes)::bigint
         where id = _conversation_id;
    end if;

    return v_row;
end;
$$;

grant execute on function public.send_conversation_message(uuid, text, text, text, integer) to authenticated;

-- ── 7. Reads for the panel ────────────────────────────────────────────────

create or replace function public.list_my_conversations()
returns table (
    id                 uuid,
    kind               text,
    title              text,
    status             text,
    my_role            text,
    member_count       integer,
    unread_count       integer,
    last_message_at    timestamptz,
    last_message_body  text,
    last_media_type    text,
    last_sender_id     uuid,
    last_sender_name   text,
    created_by         uuid,
    other_user_id      uuid,
    other_user_name    text,
    other_user_county  text
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
        c.id,
        c.kind,
        c.title,
        c.status,
        m.role as my_role,
        (select count(*)::integer from public.conversation_members mm
          where mm.conversation_id = c.id) as member_count,
        (select count(*)::integer from public.conversation_messages cm
          where cm.conversation_id = c.id
            and cm.sender_id <> v_me
            and cm.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)) as unread_count,
        c.last_message_at,
        last_msg.body as last_message_body,
        last_msg.media_type as last_media_type,
        last_msg.sender_id as last_sender_id,
        last_msg.sender_name as last_sender_name,
        c.created_by,
        other.user_id as other_user_id,
        coalesce(nullif(other_p.display_name, ''), split_part(other_p.email, '@', 1), 'Detectorist') as other_user_name,
        other_p.county as other_user_county
    from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id and m.user_id = v_me
    left join lateral (
        select cm.body, cm.media_type, cm.sender_id, cm.sender_name
          from public.conversation_messages cm
         where cm.conversation_id = c.id
         order by cm.created_at desc, cm.id desc
         limit 1
    ) last_msg on true
    left join lateral (
        select mm.user_id
          from public.conversation_members mm
         where mm.conversation_id = c.id and mm.user_id <> v_me
         order by mm.joined_at, mm.user_id
         limit 1
    ) other on c.kind = 'direct'
    left join public.user_social_profiles other_p on other_p.user_id = other.user_id
    order by coalesce(c.last_message_at, c.created_at) desc
    limit 200;
end;
$$;

grant execute on function public.list_my_conversations() to authenticated;

create or replace function public.get_conversation_members(_conversation_id uuid)
returns table (
    user_id      uuid,
    display_name text,
    email        text,
    county       text,
    role         text,
    joined_at    timestamptz,
    is_friend    boolean
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
    if not public.is_conversation_member(_conversation_id, v_me) then
        raise exception 'NOT_A_MEMBER';
    end if;

    return query
    select
        m.user_id,
        coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1), 'Detectorist') as display_name,
        p.email,
        p.county,
        m.role,
        m.joined_at,
        public.are_friends(v_me, m.user_id) as is_friend
    from public.conversation_members m
    left join public.user_social_profiles p on p.user_id = m.user_id
    where m.conversation_id = _conversation_id
    order by (m.role = 'admin') desc, m.joined_at, m.user_id;
end;
$$;

grant execute on function public.get_conversation_members(uuid) to authenticated;

-- ── 8. Retention / volume cleanup ─────────────────────────────────────────
-- Runs from pg_cron when the environment exposes it, and is also callable from
-- the browser (js/friends.js) exactly like cleanup_expired_event_chats().

create or replace function public.cleanup_social_messages()
returns table (deleted_messages integer, deleted_conversations integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limits  public.app_limits%rowtype;
    v_cut     timestamptz;
    v_msgs    integer := 0;
    v_convs   integer := 0;
    v_conv_id uuid;
    v_excess  integer;
begin
    select * into v_limits from public.app_limits where id = true;
    v_cut := now() - make_interval(days => greatest(v_limits.message_retention_days, 1));

    -- 1. Anything older than the retention window.
    with expired as (
        delete from public.conversation_messages
         where created_at < v_cut
        returning 1
    )
    select count(*)::integer into v_msgs from expired;

    -- 2. Threads that grew past the per-conversation message cap.
    for v_conv_id, v_excess in
        select cm.conversation_id,
               count(*)::integer - v_limits.max_messages_per_conversation
          from public.conversation_messages cm
         group by cm.conversation_id
        having count(*) > v_limits.max_messages_per_conversation
    loop
        if v_excess > 0 then
            with trimmed as (
                delete from public.conversation_messages
                 where conversation_id = v_conv_id
                   and id in (
                        select id from public.conversation_messages
                         where conversation_id = v_conv_id
                         order by created_at, id
                         limit v_excess
                   )
                returning 1
            )
            select v_msgs + count(*)::integer into v_msgs from trimmed;
        end if;
    end loop;

    -- 3. Counters drift after trimming; recompute only for touched threads.
    update public.conversations c
       set message_count = coalesce(s.cnt, 0),
           storage_bytes = coalesce(s.bytes, 0)
      from (
            select cm.conversation_id,
                   count(*)::integer as cnt,
                   coalesce(sum(cm.media_bytes), 0)::bigint as bytes
              from public.conversation_messages cm
             group by cm.conversation_id
      ) s
     where c.id = s.conversation_id
       and (c.message_count <> s.cnt or c.storage_bytes <> s.bytes);

    update public.conversations c
       set message_count = 0, storage_bytes = 0
     where not exists (select 1 from public.conversation_messages cm where cm.conversation_id = c.id)
       and (c.message_count <> 0 or c.storage_bytes <> 0);

    -- 4. Drop closed threads whose history has fully aged out.
    with gone as (
        delete from public.conversations c
         where c.status = 'closed'
           and c.last_message_at is not null
           and c.last_message_at < v_cut
           and not exists (select 1 from public.conversation_messages cm where cm.conversation_id = c.id)
        returning 1
    )
    select count(*)::integer into v_convs from gone;

    deleted_messages := v_msgs;
    deleted_conversations := v_convs;
    return next;
end;
$$;

grant execute on function public.cleanup_social_messages() to authenticated;

do $cron$
declare
    v_existing_job_id bigint;
begin
    begin
        create extension if not exists pg_cron;
    exception
        when insufficient_privilege then
            raise notice 'pg_cron could not be enabled in this environment.';
    end;

    if exists (select 1 from pg_namespace where nspname = 'cron') then
        select jobid
          into v_existing_job_id
          from cron.job
         where jobname = 'detectlab_cleanup_social_messages'
         limit 1;

        if v_existing_job_id is not null then
            perform cron.unschedule(v_existing_job_id);
        end if;

        perform cron.schedule(
            'detectlab_cleanup_social_messages',
            '15 3 * * *',
            $$select public.cleanup_social_messages();$$
        );
    else
        raise notice 'cron schema unavailable; browser-triggered social cleanup remains enabled.';
    end if;
exception
    when undefined_table or invalid_schema_name or insufficient_privilege then
        raise notice 'pg_cron unavailable; skipping scheduled social cleanup job.';
end
$cron$;
