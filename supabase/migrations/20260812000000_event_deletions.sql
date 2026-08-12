-- Event deletion tombstones.
--
-- Background: events are synced to a shared Supabase `events` table AND cached
-- per-user in localStorage (detectlab_events). When the creator deletes an
-- event we remove the row from `events`, but any other user who still holds the
-- event in their own local cache would re-insert it (resurrect it) the next time
-- they fetch, because the merge in js/events.js treats any local-only event as
-- "not yet synced to the server" and calls ensureEventOnServer() on it.
--
-- This table records which event ids were explicitly deleted so every client can
-- purge them from their local caches and stop re-syncing them.
--
-- Idempotent: safe to run via `supabase db push` or the SQL editor.

create table if not exists public.event_deletions (
    event_id uuid primary key,
    deleted_by uuid,
    deleted_at timestamptz not null default now()
);

-- Prune tombstones that are old enough that no client could still be holding a
-- stale local copy (local caches refresh far more often than this).
create or replace function public.prune_event_deletions(_older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pruned integer;
begin
    delete from public.event_deletions
    where deleted_at < now() - make_interval(days => _older_than_days);
    get diagnostics v_pruned = row_count;
    return v_pruned;
end;
$$;

grant execute on function public.prune_event_deletions(integer) to authenticated, anon;

alter table public.event_deletions enable row level security;
grant select, insert, delete on public.event_deletions to authenticated, anon;

drop policy if exists "Event deletions access" on public.event_deletions;
create policy "Event deletions access"
    on public.event_deletions
    for all
    to authenticated, anon
    using (true)
    with check (true);

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
        where jobname = 'detectlab_prune_event_deletions'
        limit 1;

        if v_existing_job_id is not null then
            perform cron.unschedule(v_existing_job_id);
        end if;

        perform cron.schedule(
            'detectlab_prune_event_deletions',
            '0 3 * * *',
            $$select public.prune_event_deletions(90);$$
        );
    else
        raise notice 'cron schema unavailable; client-side cleanup remains enabled.';
    end if;
exception
    when undefined_table or invalid_schema_name or insufficient_privilege then
        raise notice 'pg_cron unavailable; skipping scheduled event-deletion cleanup job.';
end
$cron$;
