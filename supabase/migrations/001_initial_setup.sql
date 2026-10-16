-- =====================================================================
-- Teph Seal Budgets — initial database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a fresh project.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------------------------------------------------

-- One row per person who can log in (linked to Supabase Auth users).
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'manager' check (role in ('admin','district','manager')),
  can_move    boolean not null default false,   -- may move money between their own stores
  active      boolean not null default false,   -- false = locked out
  created_at  timestamptz not null default now()
);

-- Budget categories (Extra Pay, SPIFF, Equipment, ...). Archived = removed but history kept.
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort        int  not null default 0,
  archived    boolean not null default false,
  pays_people boolean not null default false,   -- true = paid to employees (shows on the Pay screen)
  created_at  timestamptz not null default now()
);

create table public.stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  manager_id  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Monthly budget per store per category.
create table public.store_budgets (
  store_id     uuid not null references public.stores(id) on delete cascade,
  category_id  uuid not null references public.categories(id) on delete cascade,
  amount       numeric(12,2) not null default 0 check (amount >= 0),
  primary key (store_id, category_id)
);

-- Employees who can receive Extra Pay / SPIFF. First name + last initial only (no full names).
-- rate = their hourly or flat-rate dollars per hour, used to turn hours into dollars.
create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  first_name    text not null check (char_length(first_name) between 1 and 30),
  last_initial  text not null check (last_initial ~ '^[A-Z]$'),
  rate          numeric(8,2) not null default 0 check (rate >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Every purchase / payout logged against a store.
create table public.spend (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores(id) on delete cascade,
  category_id    uuid not null references public.categories(id) on delete restrict,
  item           text not null,
  vendor         text,
  amount         numeric(12,2) not null check (amount > 0),
  spent_on       date not null default current_date,
  employee_id    uuid references public.employees(id) on delete set null,
  employee_name  text,                          -- "Jake M." saved with the entry
  hours          numeric(6,2) check (hours is null or hours > 0),
  rate           numeric(8,2) check (rate is null or rate > 0),
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  -- when logged in hours, the dollars must equal hours × rate
  check (hours is null or rate is null or amount = round(hours * rate, 2))
);
create index spend_spent_on_idx on public.spend (spent_on);
create index spend_store_idx on public.spend (store_id);

-- Budget moved from one store to another for a single month.
create table public.moves (
  id           uuid primary key default gen_random_uuid(),
  month        date not null check (extract(day from month) = 1),
  category_id  uuid not null references public.categories(id) on delete restrict,
  from_store   uuid not null references public.stores(id) on delete cascade,
  to_store     uuid not null references public.stores(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  note         text,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (from_store <> to_store)
);
create index moves_month_idx on public.moves (month);

-- ---------- Helper functions (used by the security rules) -------------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.sees_all() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','district'), false)
$$;

create or replace function public.manages(store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member() and exists (
    select 1 from public.stores where id = store and manager_id = auth.uid())
$$;

create or replace function public.can_move_money() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and can_move)
$$;

-- New login → create a locked profile. The admin screen activates it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Security rules (Row Level Security) -----------------------
-- Admin: everything. District: sees every store, read-only (can log spend).
-- Area manager: sees only stores assigned to them, can log spend to any store.

alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.stores        enable row level security;
alter table public.store_budgets enable row level security;
alter table public.employees     enable row level security;
alter table public.spend         enable row level security;
alter table public.moves         enable row level security;

-- profiles
create policy "members see team"   on public.profiles for select using (public.is_member() or id = auth.uid());
create policy "admin edits team"   on public.profiles for all    using (public.is_admin()) with check (public.is_admin());

-- categories
create policy "members see categories" on public.categories for select using (public.is_member());
create policy "admin edits categories" on public.categories for all    using (public.is_admin()) with check (public.is_admin());

-- stores (everyone sees the store list so they can log to any store)
create policy "members see stores" on public.stores for select using (public.is_member());
create policy "admin edits stores" on public.stores for all    using (public.is_admin()) with check (public.is_admin());

-- store_budgets (money: only your own stores unless admin/district)
create policy "see own store budgets" on public.store_budgets for select using (public.sees_all() or public.manages(store_id));
create policy "admin edits budgets"   on public.store_budgets for all    using (public.is_admin()) with check (public.is_admin());

-- employees (names + rates: only your own stores unless admin/district; managers manage their own stores' list)
create policy "see own store employees" on public.employees for select using (public.sees_all() or public.manages(store_id));
create policy "add employees"    on public.employees for insert with check (public.is_admin() or public.manages(store_id));
create policy "update employees" on public.employees for update
  using (public.is_admin() or public.manages(store_id)) with check (public.is_admin() or public.manages(store_id));
create policy "admin deletes employees" on public.employees for delete using (public.is_admin());

-- spend
create policy "see spend for own stores" on public.spend for select
  using (public.sees_all() or public.manages(store_id) or (created_by = auth.uid() and public.is_member()));
create policy "members log spend" on public.spend for insert
  with check (public.is_member() and created_by = auth.uid());
create policy "admin edits spend" on public.spend for update
  using (public.is_admin()) with check (public.is_admin());
create policy "remove own or admin" on public.spend for delete
  using (public.is_admin() or (created_by = auth.uid() and public.is_member()));

-- moves
create policy "see moves for own stores" on public.moves for select
  using (public.sees_all() or public.manages(from_store) or public.manages(to_store));
create policy "admin or allowed manager moves money" on public.moves for insert
  with check (created_by = auth.uid() and (public.is_admin()
    or (public.can_move_money() and public.manages(from_store) and public.manages(to_store))));
create policy "undo own move or admin" on public.moves for delete
  using (public.is_admin() or (created_by = auth.uid() and public.is_member()));

-- ---------- Starting categories ---------------------------------------
insert into public.categories (name, sort, pays_people) values
  ('Extra Pay', 1, true), ('SPIFF', 2, true), ('Equipment', 3, false), ('Supplies', 4, false), ('Chemicals', 5, false);
