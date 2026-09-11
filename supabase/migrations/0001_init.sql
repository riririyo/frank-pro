-- frank pro — 初期スキーマ
-- 方針: セキュリティ上の不正は防ぐが、票の水増しやスパムは許容する（検知・排除の仕組みを作らない）。
-- 詳細な設計根拠は docs/security-design.md を参照。

-- ============================================================
-- 拡張
-- ============================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- profiles（作者ページ用。auth.usersの付随情報）
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '名無し',
  bio text,
  sns_links jsonb not null default '[]'::jsonb, -- [{platform, url}, ...]
  created_at timestamptz not null default now()
);

-- ============================================================
-- works（投稿作品）
-- ============================================================
create table if not exists public.works (
  id text primary key default encode(gen_random_bytes(9), 'base64'), -- nanoid相当。連番にしない
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  -- R2上のパス。配信は worker/ 経由でのみ行う
  file_path text not null,
  file_size_bytes integer not null,
  thumbnail_path text, -- 未設定ならプレースホルダをフロントで生成
  thumbnail_source text not null default 'pending' check (thumbnail_source in ('author', 'auto', 'pending')),
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  -- 集計値（日次バッチと都度更新の両方で触るのでキャッシュとして持つ）
  access_count integer not null default 0,      -- ユニーク開封数
  rating_count integer not null default 0,       -- 素の票数（重み付けなし）
  rating_avg numeric(3,2) not null default 0,    -- 素の平均点
  rating_bayes numeric(3,2) not null default 0,  -- ベイズ平均（並べ替え用に日次で再計算）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists works_author_idx on public.works(author_id);
create index if not exists works_status_idx on public.works(status);
create index if not exists works_created_idx on public.works(created_at desc);
create index if not exists works_access_idx on public.works(access_count desc);
create index if not exists works_rating_count_idx on public.works(rating_count desc);
create index if not exists works_rating_bayes_idx on public.works(rating_bayes desc);

-- ============================================================
-- work_views（アクセス数のユニーク開封数）
-- ============================================================
create table if not exists public.work_views (
  work_id text not null references public.works(id) on delete cascade,
  visitor_id text not null,
  viewed_on date not null default current_date,
  primary key (work_id, visitor_id, viewed_on)
);

-- ============================================================
-- ratings（星評価。匿名可・全票同一重み。方針: 不正対策としての重み付けはしない）
-- ============================================================
create table if not exists public.ratings (
  id bigint generated always as identity primary key,
  work_id text not null references public.works(id) on delete cascade,
  visitor_id text not null, -- ログイン済みなら auth.uid()::text、匿名ならlocalStorageのnanoid
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_id, visitor_id) -- 1作品1票。UXのための制約であり不正対策ではない
);

create index if not exists ratings_work_idx on public.ratings(work_id);

-- ============================================================
-- comments（匿名可・事前審査なし）
-- ============================================================
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  work_id text not null references public.works(id) on delete cascade,
  visitor_id text not null,       -- 削除トークンの検証に使う
  display_name text not null default 'ななし',
  body text not null check (char_length(body) <= 500),
  report_count integer not null default 0,
  is_hidden boolean not null default false, -- 作者/運営による非表示、または通報3件での自動非表示
  hidden_reason text,               -- 'author' | 'auto_report' | 'admin' | null
  -- 発信者情報。開示請求への対応のため6ヶ月保存（docs/security-design.md 3-3節）
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists comments_work_idx on public.comments(work_id, created_at desc);
create index if not exists comments_created_idx on public.comments(created_at); -- 6ヶ月削除バッチ用

-- ============================================================
-- comment_reports（通報。3件で自動非表示）
-- ============================================================
create table if not exists public.comment_reports (
  comment_id bigint not null references public.comments(id) on delete cascade,
  visitor_id text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, visitor_id)
);

-- ============================================================
-- featured（今週のfrank枠）
-- ============================================================
create table if not exists public.featured (
  id bigint generated always as identity primary key,
  work_id text not null references public.works(id) on delete cascade,
  slot text not null default 'weekly',
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists featured_active_idx on public.featured(start_at, end_at);

-- ============================================================
-- site_stats（ベイズ平均のm, C。日次バッチが更新する単一行テーブル）
-- ============================================================
create table if not exists public.site_stats (
  id boolean primary key default true check (id), -- 常に1行だけ
  bayes_m numeric(5,2) not null default 5,
  bayes_c numeric(3,2) not null default 3.5,
  updated_at timestamptz not null default now()
);
insert into public.site_stats (id) values (true) on conflict do nothing;

-- ============================================================
-- updated_at 自動更新
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_works_updated on public.works;
create trigger trg_works_updated before update on public.works
  for each row execute function public.set_updated_at();

drop trigger if exists trg_ratings_updated on public.ratings;
create trigger trg_ratings_updated before update on public.ratings
  for each row execute function public.set_updated_at();

-- ============================================================
-- rating_count / rating_avg をratings変更時に即時反映（bayesは日次バッチのみ）
-- ============================================================
create or replace function public.recompute_work_rating(p_work_id text)
returns void language sql as $$
  update public.works w set
    rating_count = coalesce(r.cnt, 0),
    rating_avg = coalesce(r.avg_score, 0)
  from (
    select count(*) as cnt, avg(score)::numeric(3,2) as avg_score
    from public.ratings where work_id = p_work_id
  ) r
  where w.id = p_work_id;
$$;

create or replace function public.trg_ratings_recompute()
returns trigger language plpgsql as $$
begin
  perform public.recompute_work_rating(coalesce(new.work_id, old.work_id));
  return null;
end;
$$;

drop trigger if exists trg_ratings_aiud on public.ratings;
create trigger trg_ratings_aiud after insert or update or delete on public.ratings
  for each row execute function public.trg_ratings_recompute();

-- ============================================================
-- 通報3件で自動非表示
-- ============================================================
create or replace function public.trg_comment_reports_check()
returns trigger language plpgsql as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.comment_reports where comment_id = new.comment_id;
  if v_count >= 3 then
    update public.comments
      set is_hidden = true, hidden_reason = 'auto_report'
      where id = new.comment_id and is_hidden = false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comment_reports_ai on public.comment_reports;
create trigger trg_comment_reports_ai after insert on public.comment_reports
  for each row execute function public.trg_comment_reports_check();
