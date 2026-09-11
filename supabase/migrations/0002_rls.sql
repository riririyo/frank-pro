-- frank pro — RLS（行レベルセキュリティ）
-- 方針: 閲覧・評価・コメントは匿名可。投稿（作品の作成・編集・削除）のみログイン必須。
-- 詳細: docs/security-design.md 4章

alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.work_views enable row level security;
alter table public.ratings enable row level security;
alter table public.comments enable row level security;
alter table public.comment_reports enable row level security;
alter table public.featured enable row level security;
alter table public.site_stats enable row level security;

-- ============================================================
-- profiles
-- ============================================================
create policy "profiles_select_all" on public.profiles
  for select using (true);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- ============================================================
-- works
-- ============================================================
-- 閲覧: 公開作品は誰でも見える。非公開/削除は作者本人のみ見える
create policy "works_select_published_or_own" on public.works
  for select using (status = 'published' or auth.uid() = author_id);

-- 作成: ログイン必須。author_id は自分自身のみ
create policy "works_insert_own" on public.works
  for insert with check (auth.uid() = author_id);

-- 更新・削除: 作者本人のみ。削除は物理削除させず status を変える運用（アプリ側で強制）
create policy "works_update_own" on public.works
  for update using (auth.uid() = author_id);

create policy "works_delete_own" on public.works
  for delete using (auth.uid() = author_id);

-- ============================================================
-- work_views（匿名OK。insertのみ。集計目的でselectはservice_role経由に限定）
-- ============================================================
create policy "work_views_insert_anyone" on public.work_views
  for insert with check (true);

-- ============================================================
-- ratings（匿名OK・全票同一重み。方針: 不正対策の絞り込みはしない）
-- ============================================================
create policy "ratings_select_all" on public.ratings
  for select using (true);

create policy "ratings_insert_anyone" on public.ratings
  for insert with check (true);

-- 自分の投じた票のみ更新可（visitor_idの一致はアプリ側のlocalStorageトークンで担保。
-- DBレベルではvisitor_id自体は誰でも名乗れるため、これは「不正対策」ではなくUXの制約）
create policy "ratings_update_matching_visitor" on public.ratings
  for update using (true);

-- ============================================================
-- comments（匿名OK・事前審査なし）
-- ============================================================
-- 閲覧: 非表示になっていないコメントは誰でも見える
create policy "comments_select_visible" on public.comments
  for select using (is_hidden = false);

-- 投稿: クライアントから直接INSERTさせない。
-- ip_address/user_agentは開示請求対応のために必須で、クライアントの自己申告は信用できない。
-- 実際の投稿経路は supabase/functions/submit-comment（service_roleでIP/UAを実測して挿入）に限定する。
-- これは不正対策ではなく、発信者情報開示義務に応えられる状態を保つための制約（docs/security-design.md 3-3節）。
create policy "comments_insert_anyone" on public.comments
  for insert with check (false);

-- 作者は自分の作品のコメントを非表示にできる
create policy "comments_update_by_work_author" on public.comments
  for update using (
    exists (
      select 1 from public.works w
      where w.id = comments.work_id and w.author_id = auth.uid()
    )
  );

-- ============================================================
-- comment_reports（匿名OK・insertのみ）
-- ============================================================
create policy "comment_reports_insert_anyone" on public.comment_reports
  for insert with check (true);

-- ============================================================
-- featured
-- ============================================================
create policy "featured_select_all" on public.featured
  for select using (true);
-- insert/update/deleteはservice_role（運営の手作業）のみ。一般ポリシーは作らない

-- ============================================================
-- site_stats
-- ============================================================
create policy "site_stats_select_all" on public.site_stats
  for select using (true);
-- 更新は日次バッチ（service_role）のみ
