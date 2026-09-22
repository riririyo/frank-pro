-- frank pro — comments.ip_address / user_agent の列レベルアクセスを塞ぐ（緊急セキュリティ修正）
--
-- 問題: comments テーブルの RLS（comments_select_visible）は行の可視性
--       （is_hidden = false）しか制御しておらず、列は制御していない。
--       一方 anon/authenticated ロールは Supabase の既定設定でテーブル全体への
--       table-wide な SELECT 権限を持っているため、ip_address / user_agent
--       （開示請求対応のためだけに保存している発信者情報。docs/security-design.md 3-3節）を
--       anon key だけで誰でも直接 select できてしまっていた（実環境で確認済み）。
--
-- 注意: 単純に
--   revoke select (ip_address, user_agent) on public.comments from anon, authenticated;
-- だけでは直らない。PostgreSQLの権限モデルでは「テーブル全体のSELECT権限」と
-- 「列単位のSELECT権限」は独立しており、ロールがテーブル全体のSELECT権限を
-- 持っている限り、特定の列だけをrevokeしても効果がない（テーブル全体の権限が
-- 優先されるため）。そのため、いったんテーブル全体のSELECTを剥奪してから、
-- 公開してよい列だけを列単位で許可し直す。
--
-- 参考: https://supabase.com/docs/guides/database/postgres/column-level-security

revoke select on public.comments from anon, authenticated;

grant select (
  id,
  work_id,
  visitor_id,
  display_name,
  body,
  report_count,
  is_hidden,
  hidden_reason,
  created_at
) on public.comments to anon, authenticated;

-- visitor_id は引き続き公開列に含める。localStorageの自己申告値でしかなく
-- （誰でも名乗れる値。delete_own_comment関数のコメント参照）、不正対策としては
-- 元々機能していない前提の設計であり、ip_address/user_agentのような法的PIIではないため
-- 今回の修正対象には含めない。
