-- frank pro — 通報（利用者が作品を通報し、管理者が確認・対応するための土台）
--
-- ログイン済みユーザーなら誰でも作品を通報できる（web/js/report-modal.js）。
-- 一覧・対応（対応済みにする）は、admin-action Edge Functionを増やさず、
-- 0009_admin_and_ban.sql と同じ「is_adminなら直接select/updateできる」RLSポリシー
-- だけで完結させている（デプロイの手間を増やさないため。web/js/admin.js参照）。

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- ログイン済みなら誰でも通報を作成できる。reporter_idは必ず自分のIDにする
-- （なりすまし防止。誰が通報したか管理者側であとから追えるようにする）。
create policy "reports_insert_own" on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- 通報の閲覧・対応は管理者だけ（他人の通報は本人にも見せない）。
create policy "reports_select_admin" on public.reports
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create policy "reports_update_admin" on public.reports
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_work_id_idx on public.reports (work_id);
