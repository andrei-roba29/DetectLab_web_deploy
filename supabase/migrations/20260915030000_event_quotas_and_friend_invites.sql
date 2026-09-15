-- ══════════════════════════════════════════════════════════════════════════
-- DetectLab Social — part 4/4: event quotas + "add friends" invites
-- ══════════════════════════════════════════════════════════════════════════
--
-- Two things happen here:
--
--   1. The event rules that js/events.js already checks in the browser become
--      database rules as well, so they cannot be bypassed by a second device,
--      an older cached client or a hand-crafted request:
--        • at most `max_events_created_active`   future events per creator
--        • at most `max_events_attending_active` future events per attendee
--        • an event may not be scheduled more than `max_event_deadline_days`
--          (365) days ahead — nobody can book a hunt five years from now
--        • event chat messages obey the same length / attachment / rate limits
--          as social messages and age out after `event_chat_retention_days`
--
--   2. `invite_friends_to_event()` powers the "Adaugă prieteni / Add friends"
--      box of the create-event form and the 📅 button inside a chat: the event
--      creator picks friends, each of them receives a participation request
--      (an `event_inquiries` row + an `event_notifications` row with
--      kind = 'friend_event_invite') that they can accept or decline.
--
-- Idempotent: safe to re-run.

alter table public.app_limits
    add column if not exists event_chat_retention_days integer not null default 90;

-- ── 1. Event creation quota + deadline ────────────────────────────────────

create or replace function public.guard_event_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limits public.app_limits%rowtype;
    v_active integer;
begin
    select * into v_limits from public.app_limits where id = true;

    -- No configuration row (very old deployment): do not block anything.
    if v_limits.max_event_deadline_days is null then
        return new;
    end if;

    if new.event_date is not null
       and new.event_date > now() + make_interval(days => v_limits.max_event_deadline_days) then
        raise exception 'EVENT_DEADLINE_TOO_FAR:%', v_limits.max_event_deadline_days;
    end if;

    -- Only FUTURE events count towards the quota; expired ones are removed by
    -- cleanup_expired_events() anyway.
    select count(*) into v_active
      from public.events e
     where e.creator_id = new.creator_id
       and e.event_date > now()
       and (tg_op = 'INSERT' or e.id <> new.id);

    if coalesce(v_active, 0) >= v_limits.max_events_created_active then
        raise exception 'EVENT_CREATION_LIMIT:%', v_limits.max_events_created_active;
    end if;

    return new;
end;
$$;

drop trigger if exists trigger_guard_event_limits on public.events;
create trigger trigger_guard_event_limits
before insert or update of event_date, creator_id on public.events
for each row
execute function public.guard_event_limits();

-- ── 2. Attendance quota ───────────────────────────────────────────────────

create or replace function public.guard_event_attendance_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limits public.app_limits%rowtype;
    v_active integer;
begin
    select * into v_limits from public.app_limits where id = true;
    if v_limits.max_events_attending_active is null then
        return new;
    end if;

    select count(*) into v_active
      from public.event_attendees a
      join public.events e on e.id = a.event_id
     where a.user_id = new.user_id
       and e.event_date > now()
       and a.event_id <> new.event_id;

    if coalesce(v_active, 0) >= v_limits.max_events_attending_active then
        raise exception 'EVENT_ATTENDANCE_LIMIT:%', v_limits.max_events_attending_active;
    end if;

    return new;
end;
$$;

drop trigger if exists trigger_guard_event_attendance_limits on public.event_attendees;
create trigger trigger_guard_event_attendance_limits
before insert on public.event_attendees
for each row
execute function public.guard_event_attendance_limits();

-- ── 3. Event chat message limits ──────────────────────────────────────────
-- Runs alongside the existing trigger_guard_event_chat_message_insert (which
-- keeps the chat lifecycle honest); this one only bounds size and rate.

create or replace function public.guard_event_chat_message_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limits  public.app_limits%rowtype;
    v_bytes   integer;
    v_per_min integer;
    v_per_day integer;
begin
    select * into v_limits from public.app_limits where id = true;
    if v_limits.event_chat_message_length is null then
        return new;
    end if;

    if length(coalesce(new.message, '')) > v_limits.event_chat_message_length then
        raise exception 'MESSAGE_TOO_LONG:%', v_limits.event_chat_message_length;
    end if;

    v_bytes := octet_length(coalesce(new.media_url, ''));
    if v_bytes > v_limits.max_attachment_bytes then
        raise exception 'ATTACHMENT_TOO_LARGE:%', v_limits.max_attachment_bytes;
    end if;

    select count(*) into v_per_min
      from public.event_chat_messages
     where user_id = new.user_id and created_at >= now() - interval '1 minute';
    if coalesce(v_per_min, 0) >= v_limits.max_messages_per_minute then
        raise exception 'RATE_LIMIT_MINUTE:%', v_limits.max_messages_per_minute;
    end if;

    select count(*) into v_per_day
      from public.event_chat_messages
     where user_id = new.user_id and created_at >= date_trunc('day', now());
    if coalesce(v_per_day, 0) >= v_limits.max_messages_per_day then
        raise exception 'RATE_LIMIT_DAY:%', v_limits.max_messages_per_day;
    end if;

    return new;
end;
$$;

create index if not exists event_chat_messages_sender_created_idx
    on public.event_chat_messages (user_id, created_at desc);

drop trigger if exists trigger_guard_event_chat_message_limits on public.event_chat_messages;
create trigger trigger_guard_event_chat_message_limits
before insert on public.event_chat_messages
for each row
execute function public.guard_event_chat_message_limits();

-- Event chats are bounded by the event date, but a hunt scheduled a year ahead
-- could otherwise accumulate messages forever: trim by age and by count.
create or replace function public.cleanup_event_chat_messages()
returns table (deleted_messages integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limits   public.app_limits%rowtype;
    v_cut      timestamptz;
    v_deleted  integer := 0;
    v_event_id uuid;
    v_excess   integer;
begin
    select * into v_limits from public.app_limits where id = true;
    v_cut := now() - make_interval(days => greatest(coalesce(v_limits.event_chat_retention_days, 90), 1));

    with expired as (
        delete from public.event_chat_messages
         where created_at < v_cut
        returning 1
    )
    select count(*)::integer into v_deleted from expired;

    for v_event_id, v_excess in
        select m.event_id,
               count(*)::integer - v_limits.max_messages_per_conversation
          from public.event_chat_messages m
         group by m.event_id
        having count(*) > v_limits.max_messages_per_conversation
    loop
        if v_excess > 0 then
            with trimmed as (
                delete from public.event_chat_messages
                 where event_id = v_event_id
                   and id in (
                        select id from public.event_chat_messages
                         where event_id = v_event_id
                         order by created_at, id
                         limit v_excess
                   )
                returning 1
            )
            select v_deleted + count(*)::integer into v_deleted from trimmed;
        end if;
    end loop;

    deleted_messages := coalesce(v_deleted, 0);
    return next;
end;
$$;

grant execute on function public.cleanup_event_chat_messages() to authenticated, anon;

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
         where jobname = 'detectlab_cleanup_event_chat_messages'
         limit 1;

        if v_existing_job_id is not null then
            perform cron.unschedule(v_existing_job_id);
        end if;

        perform cron.schedule(
            'detectlab_cleanup_event_chat_messages',
            '35 3 * * *',
            $$select public.cleanup_event_chat_messages();$$
        );
    else
        raise notice 'cron schema unavailable; browser-triggered event chat trimming remains enabled.';
    end if;
exception
    when undefined_table or invalid_schema_name or insufficient_privilege then
        raise notice 'pg_cron unavailable; skipping scheduled event chat trimming job.';
end
$cron$;

-- ── 4. Quota read used by the create-event form ───────────────────────────

create or replace function public.get_my_event_quota()
returns table (
    events_created_active   integer,
    events_created_max      integer,
    events_attending_active integer,
    events_attending_max    integer,
    max_deadline_days       integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_limits public.app_limits%rowtype;
begin
    select * into v_limits from public.app_limits where id = true;

    if v_me is null then
        return query
        select 0, coalesce(v_limits.max_events_created_active, 10),
               0, coalesce(v_limits.max_events_attending_active, 15),
               coalesce(v_limits.max_event_deadline_days, 365);
        return;
    end if;

    return query
    select
        (select count(*)::integer from public.events e
          where e.creator_id = v_me and e.event_date > now()) as events_created_active,
        coalesce(v_limits.max_events_created_active, 10) as events_created_max,
        (select count(*)::integer
           from public.event_attendees a
           join public.events e2 on e2.id = a.event_id
          where a.user_id = v_me and e2.event_date > now()) as events_attending_active,
        coalesce(v_limits.max_events_attending_active, 15) as events_attending_max,
        coalesce(v_limits.max_event_deadline_days, 365) as max_deadline_days;
end;
$$;

grant execute on function public.get_my_event_quota() to authenticated, anon;

-- ── 5. "Add friends" invites ──────────────────────────────────────────────

create or replace function public.invite_friends_to_event(_event_id uuid, _friend_ids uuid[])
returns table (user_id uuid, result text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me            uuid := auth.uid();
    v_limits        public.app_limits%rowtype;
    v_event         public.events%rowtype;
    v_targets       uuid[];
    v_id            uuid;
    v_creator_name  text;
    v_invitee_name  text;
    v_attendees     integer;
    v_pending       integer;
    v_inquiry       public.event_inquiries%rowtype;
    v_message       text;
begin
    if v_me is null then
        raise exception 'NOT_SIGNED_IN';
    end if;

    select * into v_event from public.events where id = _event_id;
    if not found then
        raise exception 'EVENT_NOT_FOUND';
    end if;
    if v_event.creator_id <> v_me then
        raise exception 'NOT_EVENT_CREATOR';
    end if;
    if v_event.event_date <= now() then
        raise exception 'EVENT_EXPIRED';
    end if;

    select * into v_limits from public.app_limits where id = true;

    select coalesce(array_agg(distinct u), '{}') into v_targets
      from unnest(coalesce(_friend_ids, '{}')) as u
     where u is not null and u <> v_me;

    if array_length(v_targets, 1) is null then
        return;
    end if;

    select nullif(
             coalesce(
                 nullif(p.display_name, ''),
                 nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
                 nullif(v_event.creator_name, '')
             ), '')
      into v_creator_name
      from public.user_social_profiles p
     where p.user_id = v_me;
    v_creator_name := coalesce(v_creator_name, 'Detectorist');

    select count(*) into v_attendees from public.event_attendees where event_id = _event_id;
    select count(*) into v_pending from public.event_inquiries
     where event_id = _event_id and status = 'pending';

    foreach v_id in array v_targets loop
        if not public.are_friends(v_me, v_id) then
            user_id := v_id; result := 'not_friend'; return next;
            continue;
        end if;

        if exists (select 1 from public.event_attendees a
                    where a.event_id = _event_id and a.user_id = v_id) then
            user_id := v_id; result := 'already_attending'; return next;
            continue;
        end if;

        if exists (select 1 from public.event_inquiries i
                    where i.event_id = _event_id and i.user_id = v_id and i.status <> 'declined') then
            user_id := v_id; result := 'already_pending'; return next;
            continue;
        end if;

        if v_event.max_attendees is not null
           and (v_attendees + v_pending) >= v_event.max_attendees then
            user_id := v_id; result := 'event_full'; return next;
            continue;
        end if;

        if v_pending >= coalesce(v_limits.max_event_invites_per_event, 50) then
            user_id := v_id; result := 'invite_limit'; return next;
            continue;
        end if;

        select nullif(
                 coalesce(
                     nullif(p2.display_name, ''),
                     nullif(split_part(coalesce(p2.email, ''), '@', 1), '')
                 ), '')
          into v_invitee_name
          from public.user_social_profiles p2
         where p2.user_id = v_id;
        v_invitee_name := coalesce(v_invitee_name, 'Detectorist');

        -- Bilingual on purpose: the notification may be rendered by a client
        -- that does not know the 'friend_event_invite' kind yet.
        v_message := v_creator_name || ' te-a invitat la evenimentul «' || coalesce(v_event.title, '') ||
                     '» / ' || v_creator_name || ' invited you to "' || coalesce(v_event.title, '') || '"';

        insert into public.event_inquiries (event_id, user_id, user_name, message, status)
        values (_event_id, v_id, v_invitee_name,
                'Invitație de la ' || v_creator_name || ' / Invitation from ' || v_creator_name,
                'pending')
        returning * into v_inquiry;

        insert into public.event_notifications
            (user_id, event_id, inquiry_id, sender_id, sender_name, message, read, kind)
        values
            (v_id, _event_id, v_inquiry.id, v_me, v_creator_name, v_message, false, 'friend_event_invite');

        v_pending := v_pending + 1;
        user_id := v_id; result := 'invited'; return next;
    end loop;
end;
$$;

grant execute on function public.invite_friends_to_event(uuid, uuid[]) to authenticated;
