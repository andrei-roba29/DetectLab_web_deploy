-- ══════════════════════════════════════════════════════════════════════════
-- DetectLab Social — unified directory search (diacritic-insensitive, partial)
-- ══════════════════════════════════════════════════════════════════════════
--
-- "Nu găsesc pe nimeni" fix. The first version of search_social_users()
-- compared the RAW query with LIKE against the RAW columns, so:
--   • "muresan" never matched "Mureșan" (ș ≠ s) — everybody types without
--     diacritics, so every name carrying Romanian diacritics was unfindable;
--   • typing a county or a city ("cluj", "oradea") matched NOTHING at all —
--     only e-mail / display name / id were searched.
--
-- This migration turns the search bar into a UNIFIED search, the same rule the
-- Supabase table editor applies: ONE query matched (partially, as a substring)
-- against EVERY visible column — display name, e-mail, county, city and the
-- account id prefix — after folding case and diacritics (Romanian comma-below
-- ș/ț AND cedilla ş/ţ spellings, plus the Hungarian/European vowels common in
-- Transylvanian names: á à ä ã å, é è ë ê, í ì ï, ó ò ö õ ø, ú ù ü û, ý ÿ,
-- ç, ñ). A multi-word query ("ana cluj") matches when EVERY word is found in
-- at least one column.
--
-- Signature and returned columns are unchanged, so the browser, the grants and
-- the RLS policies keep working untouched. Idempotent: safe to re-run via
-- `supabase db push` or the SQL editor.
--
-- NOTE on performance: the directory is small (one row per account), so plain
-- substring scans are milliseconds — no trigram extension needed. The
-- normaliser is IMMUTABLE, so expression indexes can be added later if the
-- directory ever outgrows a sequential scan.

-- ── 1. Search normalisation ─────────────────────────────────────────────
-- lower() → fold diacritics → collapse whitespace. Never returns NULL (blank
-- in, '' out) so every strpos() comparison below is a clean boolean.
-- Mirrored by searchNormalise() in test-friends-social.js — keep both in sync.

create or replace function public.search_normalise(raw text)
returns text
language sql
immutable
as $$
    select btrim(regexp_replace(
        translate(lower(coalesce(raw, '')),
                  'ăâîșşțţáàäãåéèëêíìïóòöõøúùüûýÿçñ',
                  'aaissttaaaaaeeeeiiiooooouuuuyycn'),
        '\s+', ' ', 'g'));
$$;

-- ── 2. Unified search ───────────────────────────────────────────────────
-- Same signature, same columns, same relationship logic as before — only the
-- matching rule changes. strpos()/starts_with() are used instead of LIKE so a
-- query containing '%', '_' or '\' is matched LITERALLY, never as a wildcard.

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
    v_tokens text[] := regexp_split_to_array(v_q, '\s+');
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
            cardinality(v_tokens) = 0
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

grant execute on function public.search_normalise(text) to authenticated, anon;
grant execute on function public.search_social_users(text, text, integer) to authenticated;
