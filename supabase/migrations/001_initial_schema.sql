-- families table
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_at timestamptz default now()
);

-- profiles table (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid references public.families(id) on delete set null,
  name text not null,
  role text not null default 'member' check (role in ('master', 'member')),
  created_at timestamptz default now()
);

-- app_data table (one row per family, all JSON)
create table if not exists public.app_data (
  id uuid primary key default gen_random_uuid(),
  family_id uuid unique not null references public.families(id) on delete cascade,
  data jsonb,
  updated_at timestamptz default now()
);

-- Enable Row Level Security
alter table public.families  enable row level security;
alter table public.profiles  enable row level security;
alter table public.app_data  enable row level security;

-- RLS: families — only members of the family can see it
create policy "family members can view their family"
  on public.families for select
  using (
    id in (
      select family_id from public.profiles where id = auth.uid()
    )
  );

-- RLS: profiles — users can see and update their own profile
create policy "users can view their own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());

create policy "users can insert their own profile"
  on public.profiles for insert
  with check (id = auth.uid());

-- RLS: profiles — family members can see each other
create policy "family members can view each other"
  on public.profiles for select
  using (
    family_id in (
      select family_id from public.profiles where id = auth.uid()
    )
  );

-- RLS: app_data — only family members can read/write their family data
create policy "family members can read app_data"
  on public.app_data for select
  using (
    family_id in (
      select family_id from public.profiles where id = auth.uid()
    )
  );

create policy "family members can update app_data"
  on public.app_data for update
  using (
    family_id in (
      select family_id from public.profiles where id = auth.uid()
    )
  );

create policy "family members can insert app_data"
  on public.app_data for insert
  with check (
    family_id in (
      select family_id from public.profiles where id = auth.uid()
    )
  );

-- Enable realtime for app_data
alter publication supabase_realtime add table public.app_data;
