-- 002: Mark pay entries as "entered in payroll".
-- Entries are never deleted; marking just moves them from the "To enter" list to history.
-- Safe to run more than once.

alter table public.spend
  add column if not exists processed    boolean not null default false,
  add column if not exists processed_at timestamptz,
  add column if not exists processed_by text;   -- profile id of the admin who marked it

update public.spend set processed = false where processed is null;
alter table public.spend alter column processed set not null;

-- Fast lookup of the "To enter" list.
create index if not exists spend_unprocessed_idx on public.spend (spent_on) where not processed;

-- Once payroll has it, only an admin can remove the entry (keeps history intact).
drop policy if exists "remove own or admin" on public.spend;
create policy "remove own or admin" on public.spend for delete
  using (public.is_admin() or (created_by = auth.uid() and public.is_member() and not processed));

-- Marking entered is an update, which RLS already limits to admins ("admin edits spend").
