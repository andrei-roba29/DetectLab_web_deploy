-- DetectLab event chat lifecycle
-- - Creates a real event_chats table
-- - Auto-creates a chat when an event gets its first accepted attendee
-- - Blocks chat messages for events without an active chat
-- - Expires and deletes chats when the event deadline passes

create table if not exists public.event_chats (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null unique references public.events(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    status text not null default 'active' check (status in ('active', 'expired')),
    last_message_at timestamptz
);

alter table public.event_chats
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists expires_at timestamptz,
    add column if not exists status text not null default 'active',
    add column if not exists last_message_at timestamptz;

update public.event_chats
set expires_at = coalesce(expires_at, e.event_date)
from public.events e
where e.id = public.event_chats.event_id
  and public.event_chats.expires_at is null;

alter table public.event_chats
    alter column expires_at set not null;

alter table public.event_chats
    drop constraint if exists event_chats_status_check;
alter table public.event_chats
    add constraint event_chats_status_check check (status in ('active', 'expired'));

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.event_chats'::regclass
          and conname = 'event_chats_event_id_key'
    ) then
        alter table public.event_chats
            add constraint event_chats_event_id_key unique (event_id);
    end if;
end
$$;

create index if not exists event_chats_status_expires_idx
    on public.event_chats (status, expires_at);
create index if not exists event_chats_event_idx
    on public.event_chats (event_id);

-- Prevent duplicate accepted attendees for the same event/user.
with ranked_attendees as (
    select ctid,
           row_number() over (partition by event_id, user_id order by joined_at asc, id asc) as rn
    from public.event_attendees
)
delete from public.event_attendees
where ctid in (
    select ctid from ranked_attendees where rn > 1
);

create unique index if not exists event_attendees_event_user_uidx
    on public.event_attendees (event_id, user_id);

alter table public.event_chats enable row level security;
grant select, insert, update, delete on public.event_chats to authenticated, anon;

drop policy if exists "Event chats access" on public.event_chats;
create policy "Event chats access"
    on public.event_chats
    for all
    to authenticated, anon
    using (true)
    with check (true);

create or replace function public.delete_event_chat(_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.event_chat_messages where event_id = _event_id;
    delete from public.event_chats where event_id = _event_id;
end;
$$;

grant execute on function public.delete_event_chat(uuid) to authenticated, anon;

create or replace function public.ensure_event_chat_for_event(_event_id uuid)
returns public.event_chats
language plpgsql
security definer
set search_path = public
as $$
declare
    v_event public.events%rowtype;
    v_attendee_count integer;
    v_chat public.event_chats%rowtype;
begin
    select *
    into v_event
    from public.events
    where id = _event_id;

    if not found then
        return null;
    end if;

    if v_event.event_date <= now() then
        perform public.delete_event_chat(_event_id);
        return null;
    end if;

    select count(*)
    into v_attendee_count
    from public.event_attendees
    where event_id = _event_id;

    if v_attendee_count < 1 then
        perform public.delete_event_chat(_event_id);
        return null;
    end if;

    insert into public.event_chats (event_id, expires_at, status)
    values (_event_id, v_event.event_date, 'active')
    on conflict (event_id) do update
        set expires_at = excluded.expires_at,
            status = case
                when excluded.expires_at <= now() then 'expired'
                else 'active'
            end
    returning * into v_chat;

    return v_chat;
end;
$$;

grant execute on function public.ensure_event_chat_for_event(uuid) to authenticated, anon;

create or replace function public.sync_event_chat_from_attendees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.ensure_event_chat_for_event(coalesce(new.event_id, old.event_id));
    return coalesce(new, old);
end;
$$;

create or replace function public.sync_event_chat_from_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.ensure_event_chat_for_event(new.id);
    return new;
end;
$$;

create or replace function public.guard_event_chat_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.ensure_event_chat_for_event(new.event_id);

    if not exists (
        select 1
        from public.event_chats
        where event_id = new.event_id
          and status = 'active'
          and expires_at > now()
    ) then
        raise exception 'Event chat is not active for event %', new.event_id;
    end if;

    return new;
end;
$$;

create or replace function public.touch_event_chat_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.event_chats
    set last_message_at = new.created_at,
        status = case when expires_at <= now() then 'expired' else status end
    where event_id = new.event_id;

    return new;
end;
$$;

drop trigger if exists trigger_sync_event_chat_from_attendees on public.event_attendees;
create trigger trigger_sync_event_chat_from_attendees
after insert or update or delete on public.event_attendees
for each row
execute function public.sync_event_chat_from_attendees();

drop trigger if exists trigger_sync_event_chat_from_event on public.events;
create trigger trigger_sync_event_chat_from_event
after insert or update of event_date on public.events
for each row
execute function public.sync_event_chat_from_event();

drop trigger if exists trigger_guard_event_chat_message_insert on public.event_chat_messages;
create trigger trigger_guard_event_chat_message_insert
before insert on public.event_chat_messages
for each row
execute function public.guard_event_chat_message_insert();

drop trigger if exists trigger_touch_event_chat_last_message on public.event_chat_messages;
create trigger trigger_touch_event_chat_last_message
after insert on public.event_chat_messages
for each row
execute function public.touch_event_chat_last_message();

create or replace function public.cleanup_expired_event_chats()
returns table (deleted_chats integer, deleted_messages integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_expired_event_ids uuid[];
begin
    select coalesce(array_agg(event_id), '{}')
    into v_expired_event_ids
    from (
        select c.event_id
        from public.event_chats c
        where c.expires_at <= now()
           or c.status = 'expired'
        union
        select e.id as event_id
        from public.events e
        where e.event_date <= now()
          and exists (
              select 1
              from public.event_chats c2
              where c2.event_id = e.id
          )
    ) expired;

    if coalesce(array_length(v_expired_event_ids, 1), 0) = 0 then
        return query select 0, 0;
        return;
    end if;

    with deleted_messages_cte as (
        delete from public.event_chat_messages
        where event_id = any(v_expired_event_ids)
        returning 1
    ),
    deleted_chats_cte as (
        delete from public.event_chats
        where event_id = any(v_expired_event_ids)
        returning 1
    )
    select
        (select count(*) from deleted_chats_cte),
        (select count(*) from deleted_messages_cte)
    into deleted_chats, deleted_messages;

    return next;
end;
$$;

grant execute on function public.cleanup_expired_event_chats() to authenticated, anon;

-- Backfill chat rows for already-approved events.
insert into public.event_chats (event_id, expires_at, status, last_message_at)
select
    e.id,
    e.event_date,
    'active',
    max(m.created_at) as last_message_at
from public.events e
join public.event_attendees a
    on a.event_id = e.id
left join public.event_chat_messages m
    on m.event_id = e.id
where e.event_date > now()
group by e.id, e.event_date
on conflict (event_id) do update
    set expires_at = excluded.expires_at,
        status = excluded.status,
        last_message_at = excluded.last_message_at;

select public.cleanup_expired_event_chats();

-- Best-effort automatic cleanup in hosted Postgres environments that expose pg_cron.
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
        where jobname = 'detectlab_cleanup_expired_event_chats'
        limit 1;

        if v_existing_job_id is not null then
            perform cron.unschedule(v_existing_job_id);
        end if;

        perform cron.schedule(
            'detectlab_cleanup_expired_event_chats',
            '*/5 * * * *',
            $$select public.cleanup_expired_event_chats();$$
        );
    else
        raise notice 'cron schema unavailable; client-side cleanup remains enabled.';
    end if;
exception
    when undefined_table or invalid_schema_name or insufficient_privilege then
        raise notice 'pg_cron unavailable; skipping scheduled event chat cleanup job.';
end
$cron$;