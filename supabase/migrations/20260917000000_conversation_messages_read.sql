-- ══════════════════════════════════════════════════════════════════════════
-- DetectLab Social — part 5/5: member-checked thread reads
-- ══════════════════════════════════════════════════════════════════════════
--
-- get_conversation_messages() returns the newest page of a thread for one of
-- its members. It exists for one reason: the client used to read
-- conversation_messages with a direct SELECT, which silently yields zero rows
-- whenever the SELECT policies on a production project drift (or were never
-- applied the way the migrations define them). The sender still sees their own
-- message — the send RPC returns the row and the browser mirrors it locally —
-- while the friends' reads come back empty: "apar ca trimise dar prietenii nu
-- le pot vedea".
--
-- As SECURITY DEFINER with its own membership check this function keeps the
-- thread readable regardless of the SELECT policies, and the client prefers it
-- over the direct SELECT (which stays as the fallback for projects where this
-- migration was not applied yet). The same function backs the verify-after-send
-- check in js/friends.js.
--
-- Idempotent: safe to re-run.

create or replace function public.get_conversation_messages(_conversation_id uuid, _limit_n integer default 400)
returns table (
    id              uuid,
    conversation_id uuid,
    sender_id       uuid,
    sender_name     text,
    body            text,
    media_url       text,
    media_type      text,
    media_bytes     integer,
    created_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_limit integer := greatest(coalesce(_limit_n, 400), 1);
begin
    if auth.uid() is null then
        raise exception 'NOT_SIGNED_IN';
    end if;
    if not public.is_conversation_member(_conversation_id, auth.uid()) then
        raise exception 'NOT_A_MEMBER';
    end if;

    if v_limit > 1000 then
        v_limit := 1000;
    end if;

    -- Newest first; the caller reverses into chronological order. Reading the
    -- newest page (instead of the oldest) is what keeps fresh arrivals visible
    -- in long threads.
    return query
    select m.id, m.conversation_id, m.sender_id, m.sender_name, m.body,
           m.media_url, m.media_type, m.media_bytes, m.created_at
      from public.conversation_messages m
     where m.conversation_id = _conversation_id
     order by m.created_at desc, m.id desc
     limit v_limit;
end;
$$;

grant execute on function public.get_conversation_messages(uuid, integer) to authenticated;
