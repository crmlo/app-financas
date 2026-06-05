-- ============================================================
-- STEP 1 — Drop everything cleanly (safe to run multiple times)
-- ============================================================

-- Drop trigger + function first
drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- Drop policies
drop policy if exists "family members can view their family"    on public.families;
drop policy if exists "authenticated users can create a family" on public.families;

drop policy if exists "users can view their own profile"   on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "users can insert their own profile" on public.profiles;
drop policy if exists "family members can view each other" on public.profiles;

drop policy if exists "family members can read app_data"   on public.app_data;
drop policy if exists "family members can update app_data" on public.app_data;
drop policy if exists "family members can insert app_data" on public.app_data;

-- Drop helper function
drop function if exists public.get_my_family_id();

-- Drop tables (cascade removes foreign key deps)
drop table if exists public.app_data  cascade;
drop table if exists public.profiles  cascade;
drop table if exists public.families  cascade;

-- ============================================================
-- STEP 2 — Recreate tables
-- ============================================================

create table public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text unique not null,
  created_at  timestamptz default now()
);

-- Extends auth.users: one profile per user
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  family_id  uuid references public.families(id) on delete set null,
  name       text not null,
  role       text not null default 'member' check (role in ('master', 'member')),
  created_at timestamptz default now()
);

-- One JSON blob per family — stores all app state
create table public.app_data (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid unique not null references public.families(id) on delete cascade,
  data       jsonb,
  updated_at timestamptz default now()
);

-- ============================================================
-- STEP 3 — Enable RLS on all tables
-- ============================================================

alter table public.families  enable row level security;
alter table public.profiles  enable row level security;
alter table public.app_data  enable row level security;

-- ============================================================
-- STEP 4 — Helper function (SECURITY DEFINER breaks recursion)
--
-- Reads the current user's family_id directly, bypassing RLS.
-- Used by all policies that need to know "which family is this user in?"
-- WITHOUT this, policies that query `profiles` inside a `profiles` policy
-- cause infinite recursion (HTTP 500 / error code 42P17).
-- ============================================================

create or replace function public.get_my_family_id()
returns uuid
language sql
security definer        -- runs as the function owner, bypasses RLS
stable                  -- same result within a single query
set search_path = public -- prevents search_path injection
as $$
  select family_id
  from   public.profiles
  where  id = auth.uid()
  limit  1
$$;

-- ============================================================
-- STEP 5 — RLS policies for `families`
-- ============================================================

-- Any authenticated user can create a family (needed for onboarding)
create policy "authenticated users can create a family"
  on public.families
  for insert
  to authenticated
  with check (true);

-- Members can only read their own family
create policy "family members can view their family"
  on public.families
  for select
  using (id = public.get_my_family_id());

-- ============================================================
-- STEP 6 — RLS policies for `profiles`
--
-- NOTE: policies here must NOT query `profiles` directly —
-- that causes infinite recursion. Use get_my_family_id() instead.
-- ============================================================

-- Every authenticated user can create their own profile
create policy "users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

-- Users can read their own profile
create policy "users can view their own profile"
  on public.profiles
  for select
  using (id = auth.uid());

-- Users can update their own profile (e.g. set family_id after joining)
create policy "users can update their own profile"
  on public.profiles
  for update
  using (id = auth.uid());

-- Family members can see each other's profiles
-- Uses get_my_family_id() — avoids the recursive self-join
create policy "family members can view each other"
  on public.profiles
  for select
  using (
    family_id is not null
    and family_id = public.get_my_family_id()
  );

-- ============================================================
-- STEP 7 — RLS policies for `app_data`
-- ============================================================

create policy "family members can read app_data"
  on public.app_data
  for select
  using (family_id = public.get_my_family_id());

create policy "family members can insert app_data"
  on public.app_data
  for insert
  to authenticated
  with check (family_id = public.get_my_family_id());

create policy "family members can update app_data"
  on public.app_data
  for update
  using (family_id = public.get_my_family_id());

-- ============================================================
-- STEP 8 — Trigger: auto-create profile on auth.users insert
--
-- When a user signs up via supabase.auth.signUp(), a row is inserted
-- into auth.users. This trigger immediately creates the corresponding
-- row in public.profiles so the app never has to do it manually.
--
-- The name comes from user_metadata.name (set at signUp time).
-- family_id starts as NULL — the user links it during onboarding.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'master'
  )
  on conflict (id) do nothing;  -- idempotent: skip if profile already exists
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- STEP 9 — Realtime
-- ============================================================

-- Only add if not already a member of the publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_data'
  ) then
    alter publication supabase_realtime add table public.app_data;
  end if;
end
$$;
