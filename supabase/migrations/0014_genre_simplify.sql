-- frank pro — ジャンル整理（タグ機能の廃止 → ジャンル1つ＋スマホ対応＋音声自動判定）
--
-- 背景: カテゴリ・操作環境タグ・内容タグの3層が重複していて投稿者・閲覧者ともに迷うため、
-- 0013(旧版, tags text[]列)を「ジャンル1つ + mobile_ok + has_sound」の2項目に置き換える。
-- 0013は既に適用済みの前提でこのマイグレーションを書く（tags列からの移行）。

alter table public.works
  add column if not exists mobile_ok boolean not null default true,
  add column if not exists has_sound boolean not null default false;

-- 旧tagsの内容をmobile_ok/has_soundに反映してから列を削除する
update public.works set mobile_ok = false
  where tags && array['keyboard_required','mouse_required','controller','pc_only'];
update public.works set has_sound = true where 'sound' = any(tags);

create index if not exists works_mobile_ok_idx on public.works (mobile_ok);

-- カテゴリ値の移行（旧値→新7種）
-- 旧VALID_CATEGORIESは ["game", "product"] の2値のみで、ジャンルを判別する情報を
-- 持っていない。そのため以下の通り寄せる:
--   product → tool   （プロダクト＝ツール・アプリとみなすのが最も近い）
--   game    → other  （どのジャンルかを判別する材料が無いため「その他・実験」に寄せる。
--                       実際のジャンルは投稿者・運営が後から個別に手動修正する想定）
update public.works set category = 'tool' where category = 'product';
update public.works set category = 'other' where category = 'game';
-- 上記2値以外の想定外の値が残っていた場合も安全側でotherに寄せる
update public.works set category = 'other'
  where category not in ('action','puzzle','adventure','simulation','casual','tool','other');

alter table public.works drop constraint if exists works_tags_limit;
drop index if exists works_tags_gin_idx;
alter table public.works drop column if exists tags;
