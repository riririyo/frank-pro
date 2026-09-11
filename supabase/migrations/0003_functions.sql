-- frank pro — RPC関数
-- security definer で anon から呼べるようにするが、やること自体は絞ってある

-- ============================================================
-- record_view: ユニーク開封数のカウント
-- 同一 (work_id, visitor_id, 日付) は1回だけ access_count が増える
-- ============================================================
create or replace function public.record_view(p_work_id text, p_visitor_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean;
begin
  insert into public.work_views (work_id, visitor_id, viewed_on)
  values (p_work_id, p_visitor_id, current_date)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted then
    update public.works set access_count = access_count + 1 where id = p_work_id;
  end if;
end;
$$;

grant execute on function public.record_view(text, text) to anon, authenticated;

-- ============================================================
-- upsert_rating: 星評価（匿名可・全票同一重み・1作品1票）
-- ============================================================
create or replace function public.upsert_rating(p_work_id text, p_visitor_id text, p_score smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_score < 1 or p_score > 5 then
    raise exception 'score must be between 1 and 5';
  end if;

  insert into public.ratings (work_id, visitor_id, score)
  values (p_work_id, p_visitor_id, p_score)
  on conflict (work_id, visitor_id)
  do update set score = excluded.score, updated_at = now();
  -- rating_count / rating_avg は trg_ratings_aiud トリガーが自動再計算する
end;
$$;

grant execute on function public.upsert_rating(text, text, smallint) to anon, authenticated;

-- ============================================================
-- report_comment: 通報（3件で自動非表示。トリガー側で処理済み）
-- ============================================================
create or replace function public.report_comment(p_comment_id bigint, p_visitor_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.comment_reports (comment_id, visitor_id)
  values (p_comment_id, p_visitor_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.report_comment(bigint, text) to anon, authenticated;

-- ============================================================
-- hide_own_comment: 作者が自分の作品のコメントを非表示にする
-- ============================================================
create or replace function public.hide_own_comment(p_comment_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select w.author_id into v_author
  from public.comments c join public.works w on w.id = c.work_id
  where c.id = p_comment_id;

  if v_author is null or v_author <> auth.uid() then
    raise exception 'not authorized';
  end if;

  update public.comments set is_hidden = true, hidden_reason = 'author'
  where id = p_comment_id;
end;
$$;

grant execute on function public.hide_own_comment(bigint) to authenticated;

-- ============================================================
-- delete_own_comment: 投稿者本人がトークン一致で削除
-- （visitor_idはlocalStorageで管理。誰でも名乗れる値なので厳密な本人確認ではない。
--   ただし「間違えて送った/消したい」というUXのための機能であり、不正対策ではない）
-- ============================================================
create or replace function public.delete_own_comment(p_comment_id bigint, p_visitor_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.comments
  where id = p_comment_id and visitor_id = p_visitor_id;
end;
$$;

grant execute on function public.delete_own_comment(bigint, text) to anon, authenticated;

-- ============================================================
-- get_random_work: 「適当に遊ぶ」ボタン用
-- 0本〜数百本の時期の最大の発見装置（docs/frank-pro-handoff.md 5章）
-- ============================================================
create or replace function public.get_random_work()
returns setof public.works
language sql
stable
as $$
  select * from public.works
  where status = 'published'
  order by random()
  limit 1;
$$;

grant execute on function public.get_random_work() to anon, authenticated;

-- ============================================================
-- apply_bayesian_scores: 全作品の rating_bayes を一括更新
-- 日次バッチ（scripts/daily/recompute-bayesian.mjs）から service_role で呼ばれる想定。
-- anon/authenticated には実行権限を与えない（並べ替えの根拠となる値を誰でも書き換えられると困るため）。
-- ============================================================
create or replace function public.apply_bayesian_scores(p_m numeric, p_c numeric)
returns void
language sql
as $$
  update public.works
  set rating_bayes = (
    (rating_count::numeric / (rating_count + p_m)) * rating_avg
    + (p_m / (rating_count + p_m)) * p_c
  )
  where status = 'published';
$$;
-- service_role はデフォルトで全関数を実行できるため、anon/authenticatedへのgrantはしない
