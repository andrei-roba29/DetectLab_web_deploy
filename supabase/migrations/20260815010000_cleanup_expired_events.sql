-- Automatically remove events once their event_date has passed.
--
-- Event chats were already cleaned after expiration, but the parent event and
-- its other dependent rows remained in the database and in clients' local
-- caches. This function removes the complete event tree and records tombstones
-- so an older offline client cannot upload an expired event again.

create or replace function public.cleanup_expired_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_expired_ids uuid[];
    v_deleted integer := 0;
begin
    select coalesce(array_agg(id), '{}')
      into v_expired_ids
      from public.events
     where event_date <= now();

    if coalesce(array_length(v_expired_ids, 1), 0) = 0 then
        return 0;
    end if;

    -- Keep a tombstone long enough for stale localStorage caches to learn that
    -- these records are gone rather than treating them as offline creations.
    insert into public.event_deletions (event_id, deleted_by, deleted_at)
    select id, null, now()
      from unnest(v_expired_ids) as expired(id)
    on conflict (event_id) do update
        set deleted_at = excluded.deleted_at;

    -- Child tables use ON DELETE CASCADE (including event chats/messages).
    delete from public.events
     where id = any(v_expired_ids);
    get diagnostics v_deleted = row_count;

    return v_deleted;
end;
$$;

grant execute on function public.cleanup_expired_events() to authenticated, anon;

-- Clean up anything that expired before this migration was installed.
select public.cleanup_expired_events();

-- Server-side cleanup keeps working even while no browser has the app open.
-- pg_cron is best-effort because some self-hosted environments do not expose it.
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
         where jobname = 'detectlab_cleanup_expired_events'
         limit 1;

        if v_existing_job_id is not null then
            perform cron.unschedule(v_existing_job_id);
        end if;

        perform cron.schedule(
            'detectlab_cleanup_expired_events',
            '* * * * *',
            $$select public.cleanup_expired_events();$$
        );
    else
        raise notice 'cron schema unavailable; browser-triggered cleanup remains enabled.';
    end if;
exception
    when undefined_table or invalid_schema_name or insufficient_privilege then
        raise notice 'pg_cron unavailable; skipping scheduled expired-event cleanup job.';
end
$cron$;
