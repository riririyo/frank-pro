-- frank pro — 作品ジャンル（ゲーム / プロダクト）を追加
-- 投稿画面でどちらか選んでもらい、一覧・作者ページのカードにバッジ表示する。

alter table public.works
  add column if not exists category text not null default 'game'
    check (category in ('game', 'product'));

create index if not exists works_category_idx on public.works (category);
