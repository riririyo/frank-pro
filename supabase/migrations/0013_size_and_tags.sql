-- frank pro — worksバケットのファイルサイズ上限を10MBに変更
update storage.buckets set file_size_limit = 10485760 where id = 'works';

-- frank pro — タグ機能の追加
alter table public.works
  add column if not exists tags text[] not null default '{}';

-- タグの語彙（有効な値）はコード側（web/js/tags.js, sign-upload Edge Function）で
-- 機動的に増減させる想定のため、DB側で個別の値までは固定しない。
-- 乱発（スパム・検索汚染）だけは件数でガードする。
alter table public.works
  add constraint works_tags_limit
  check (array_length(tags, 1) is null or array_length(tags, 1) <= 6);

create index if not exists works_tags_gin_idx on public.works using gin (tags);

-- frank pro — worksへの直接クライアントINSERTを閉じる（未使用のRLS抜け穴の修正）
-- 実際のアプリは投稿を常にsign-upload Edge Function（service_role）経由でのみ行っており、
-- クライアントから直接 supabase.from('works').insert() を呼ぶ経路は存在しない
-- （web/js/submit.js確認済み）。しかし works_insert_own（0002_rls.sql）は
-- auth.uid() = author_id しかチェックしておらず、guard_works_protected_columns
-- トリガー（0008_fix_ratings_and_works_rls.sql）はBEFORE UPDATEのみでBEFORE INSERTには
-- 効かない。そのため理論上、ログイン済みユーザーが直接INSERTでrating_count/rating_avg/
-- rating_bayesを最初から高い値に設定した「中身の無い偽作品」を作れてしまう
-- （ベイズ平均の仕組みが守ろうとしている問題を、経路を変えて再現できてしまう）。
-- アプリが使っていない経路なので閉じる。
drop policy if exists "works_insert_own" on public.works;
