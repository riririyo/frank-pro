-- frank pro — 管理者フラグ・BANフラグ
--
-- 管理画面（admin.html）から、作品の非表示/復元/完全削除、アカウントのBANを
-- 行えるようにするための土台。実際の管理操作は supabase/functions/admin-action
-- （service_role・is_admin確認あり）経由でのみ行い、is_admin/is_bannedへの
-- 書き込みをanon/authenticatedに直接許可するポリシーは作らない
-- （＝自分で自分をadminにする、他人をBANするといった操作を防ぐため）。

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_banned boolean not null default false;

-- 管理者は全作品を閲覧できる（既存の works_select_published_or_own に加えて、
-- 「自分がadminなら無条件に見える」ポリシーを追加。複数のSELECTポリシーは
-- OR結合されるため、公開作品・自分の作品・管理者、のいずれかを満たせば見える）。
create policy "works_select_admin" on public.works
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 自分自身のprofilesを含め、is_admin/is_bannedを直接書き換えられないようにする。
-- （profiles_update_own はauth.uid() = id であれば全列updateを許可しているため、
--  このガードが無いと「自分でis_admin=trueにする」を防げない）
create or replace function public.guard_profiles_protected_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if new.is_admin is distinct from old.is_admin
      or new.is_banned is distinct from old.is_banned
    then
      raise exception 'is_admin / is_banned は管理操作(admin-action Edge Function)経由でのみ変更できます';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_protected on public.profiles;
create trigger trg_profiles_guard_protected before update on public.profiles
  for each row execute function public.guard_profiles_protected_columns();

-- ============================================================
-- 初回セットアップ手順（このファイルを適用した後、手動で1回だけ実行する）:
--
--   update public.profiles set is_admin = true where id = '<自分のauth.users.id>';
--
-- 自分のuser idは Supabaseダッシュボード > Authentication > Users で確認するか、
-- ログイン後にブラウザのコンソールで
--   (await supabase.auth.getUser()).data.user.id
-- を実行して調べる。
-- ============================================================
