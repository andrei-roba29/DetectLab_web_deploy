-- Events feature tables for DetectLab

create table if not exists public.events (
    id uuid primary key default gen_random_uuid(),
    creator_id uuid not null references auth.users(id) on delete cascade,
    creator_name text not null,
    title text not null,
    description text,
    latitude double precision not null,
    longitude double precision not null,
    event_date timestamptz not null,
    max_attendees integer,
    created_at timestamptz not null default now()
);

create table if not exists public.event_inquiries (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    user_name text not null,
    message text check (length(message) <= 1000),
    status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
    created_at timestamptz not null default now()
);

create table if not exists public.event_attendees (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    user_name text not null,
    joined_at timestamptz not null default now()
);

create table if not exists public.event_chat_messages (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    user_name text not null,
    message text,
    media_url text,
    media_type text default 'none' check (media_type in ('none', 'image', 'video')),
    created_at timestamptz not null default now()
);

create table if not exists public.event_notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    event_id uuid references public.events(id) on delete cascade,
    inquiry_id uuid references public.event_inquiries(id) on delete cascade,
    sender_id uuid references auth.users(id) on delete cascade,
    sender_name text,
    message text,
    read boolean not null default false,
    created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.events enable row level security;
alter table public.event_inquiries enable row level security;
alter table public.event_attendees enable row level security;
alter table public.event_chat_messages enable row level security;
alter table public.event_notifications enable row level security;

-- Grants
grant select, insert, update, delete on public.events to authenticated, anon;
grant select, insert, update, delete on public.event_inquiries to authenticated, anon;
grant select, insert, update, delete on public.event_attendees to authenticated, anon;
grant select, insert, update, delete on public.event_chat_messages to authenticated, anon;
grant select, insert, update, delete on public.event_notifications to authenticated, anon;

-- RLS Policies (permissive for authenticated users)
drop policy if exists "Anyone can read events" on public.events;
create policy "Anyone can read events" on public.events for select using (true);

drop policy if exists "Users can create events" on public.events;
create policy "Users can create events" on public.events for insert to authenticated with check (true);

drop policy if exists "Creator can update or delete events" on public.events;
create policy "Creator can update or delete events" on public.events for all to authenticated using (true);

drop policy if exists "Inquiries access" on public.event_inquiries;
create policy "Inquiries access" on public.event_inquiries for all to authenticated using (true) with check (true);

drop policy if exists "Attendees access" on public.event_attendees;
create policy "Attendees access" on public.event_attendees for all to authenticated using (true) with check (true);

drop policy if exists "Chat access" on public.event_chat_messages;
create policy "Chat access" on public.event_chat_messages for all to authenticated using (true) with check (true);

drop policy if exists "Notifications access" on public.event_notifications;
create policy "Notifications access" on public.event_notifications for all to authenticated using (true) with check (true);
