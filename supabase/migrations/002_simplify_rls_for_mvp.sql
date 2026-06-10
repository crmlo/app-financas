-- ============================================================
-- MVP: Replace family-scoped RLS with simple auth-only policies
-- Reason: get_my_family_id() returns NULL before onboarding,
--         blocking families/app_data access in cascade.
-- ============================================================

-- Drop all existing policies
drop policy if exists "family members can view their family"    on public.families;
drop policy if exists "authenticated users can create a family" on public.families;

drop policy if exists "users can view their own profile"   on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "users can insert their own profile" on public.profiles;
drop policy if exists "family members can view each other" on public.profiles;

drop policy if exists "family members can read app_data"   on public.app_data;
drop policy if exists "family members can update app_data" on public.app_data;
drop policy if exists "family members can insert app_data" on public.app_data;

-- ============================================================
-- families: any authenticated user can read/write
-- ============================================================
create policy "authenticated can read families"
  on public.families for select
  to authenticated
  using (true);

create policy "authenticated can insert families"
  on public.families for insert
  to authenticated
  with check (true);

create policy "authenticated can update families"
  on public.families for update
  to authenticated
  using (true);

-- ============================================================
-- profiles: users manage their own row; can read all profiles
-- ============================================================
create policy "authenticated can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

-- ============================================================
-- app_data: any authenticated user can read/write
-- ============================================================
create policy "authenticated can read app_data"
  on public.app_data for select
  to authenticated
  using (true);

create policy "authenticated can insert app_data"
  on public.app_data for insert
  to authenticated
  with check (true);

create policy "authenticated can update app_data"
  on public.app_data for update
  to authenticated
  using (true);
