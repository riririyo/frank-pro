-- frank pro — 評価(ratings)の直接改ざん防止 と works の保護カラム化
--
-- 【評価について】
-- 0002_rls.sql の ratings_insert_anyone / ratings_update_matching_visitor は
-- どちらも `using (true)` で、実質「誰でも・どの票でも」直接書き換えられる
-- 状態だった。ratings_update_matching_visitor という名前は「自分の投じた票
-- のみ更新可」だが、実際のUSING句はvisitor_idの一致すら見ていない。
--
-- 実際の投票はすべて upsert_rating() RPC（0003_functions.sql、security definer）
-- 経由で行われており、この関数はテーブル所有者権限で動くためRLSの影響を受けない。
-- つまりこの2つのポリシーは無くても票の投稿・変更機能はそのまま動く。
-- 削除することで「匿名の第三者が他人の既存の評価を直接書き換える」経路を塞ぐ。
drop policy if exists "ratings_insert_anyone" on public.ratings;
drop policy if exists "ratings_update_matching_visitor" on public.ratings;

-- 【worksの保護カラムについて】
-- works_update_own（0002_rls.sql）は「作者は自分の作品を更新できる」という
-- 広いポリシーで、列を絞る条件が無い。ステータス変更やサムネ差し替えのために
-- 必要な広さだが、そのままだと作者が自分の works 行を直接updateして
-- rating_count / rating_avg / rating_bayes（評価の捏造）、access_count
-- （アクセス数の捏造）、file_path / file_size_bytes / author_id（作品実体の
-- すり替え）まで書き換えられてしまう。
--
-- これらは全部サーバー側（トリガー・日次バッチ・sign-upload Edge Function）
-- だけが更新すべき値なので、トリガーで「service_role / postgres（＝security
-- definer関数経由）以外からの変更」を拒否する。
-- status・thumbnail_path・thumbnail_source・title・description・category は
-- 引き続き作者が直接updateできる（mypage.js / thumbnail.js が使用）。
create or replace function public.guard_works_protected_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if new.rating_count is distinct from old.rating_count
      or new.rating_avg is distinct from old.rating_avg
      or new.rating_bayes is distinct from old.rating_bayes
      or new.access_count is distinct from old.access_count
      or new.file_path is distinct from old.file_path
      or new.file_size_bytes is distinct from old.file_size_bytes
      or new.author_id is distinct from old.author_id
    then
      raise exception 'これらの項目は直接変更できません（rating_count/rating_avg/rating_bayes/access_count/file_path/file_size_bytes/author_id）';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_works_guard_protected on public.works;
create trigger trg_works_guard_protected before update on public.works
  for each row execute function public.guard_works_protected_columns();
