-- user_profiles: foundation for VIP / watchlist features
-- Run in Supabase SQL Editor. App does not depend on this table yet.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  plan text not null default 'free'
    check (plan in ('free', 'vip')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_plan_idx
  on public.user_profiles (plan);

alter table public.user_profiles enable row level security;

-- Users can read their own profile
create policy "Users can read own profile"
  on public.user_profiles for select
  to authenticated
  using (auth.uid() = id);

-- Users can update their own profile
-- Note: later, restrict `plan` updates to service_role only
create policy "Users can update own profile"
  on public.user_profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row on first sign-up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Future (not created yet): watchlists
-- ---------------------------------------------------------------------------
-- create table public.watchlist_items (
--   id uuid primary key default gen_random_uuid(),
--   user_id uuid not null references public.user_profiles (id) on delete cascade,
--   stock_id text not null,
--   notes text,
--   created_at timestamptz not null default now(),
--   unique (user_id, stock_id)
-- );
-- alter table public.watchlist_items enable row level security;
-- create policy "Users manage own watchlist"
--   on public.watchlist_items for all
--   to authenticated
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
