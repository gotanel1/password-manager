-- One encrypted vault per user. The server only ever sees ciphertext:
-- encryption/decryption happens in the browser with the user's master password.
create table if not exists public.vaults (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  blob       jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  -- Sanity check that only the expected encrypted envelope is stored.
  constraint blob_is_encrypted check (blob ? 'ct' and blob ? 'iv' and blob ? 'salt')
);

alter table public.vaults enable row level security;

-- Each user can only see and change their own row.
create policy "vaults_select_own" on public.vaults
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "vaults_insert_own" on public.vaults
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "vaults_update_own" on public.vaults
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "vaults_delete_own" on public.vaults
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Enforce optimistic concurrency server-side: every update must bump version by exactly 1.
create or replace function public.vaults_bump_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.version <> old.version + 1 then
    raise exception 'version conflict' using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vaults_bump_version on public.vaults;
create trigger vaults_bump_version before update on public.vaults
  for each row execute function public.vaults_bump_version();

-- Anonymous visitors get nothing.
revoke all on public.vaults from anon;
