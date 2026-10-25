-- AlgoDojo 云同步：单行 JSON 状态表
-- 在 Supabase → SQL Editor 里整段执行

create table if not exists public.algodojo_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.algodojo_state enable row level security;

drop policy if exists "algodojo own state" on public.algodojo_state;

create policy "algodojo own state" on public.algodojo_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
