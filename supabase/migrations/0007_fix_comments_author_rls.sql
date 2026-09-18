-- frank pro — コメントへの直接UPDATE権限を塞ぐ（RLSの穴の修正）
--
-- 問題:
-- 0002_rls.sql の comments_update_by_work_author は「作者は自分の作品に
-- 付いたコメントを非表示にできる」という意図で書いたポリシーだったが、
-- is_hidden / hidden_reason など特定の列に絞る条件（WITH CHECKでの列制限）が
-- 無かった。そのため実際には、作者が自分の作品に付いたコメントの
-- body（本文）や display_name（表示名）を含め、どの列でも直接書き換えられて
-- しまう状態だった。
--
-- サイトの「非表示にする」ボタン自体はこのポリシーを使わず、専用のRPC
-- hide_own_comment()（0003_functions.sql）経由で is_hidden / hidden_reason だけを
-- 更新している。この関数は security definer（テーブル所有者権限で実行）なので
-- RLSの制約を受けず、関数内部で本人確認をしてから該当2列だけを更新する。
--
-- つまりこのポリシーが無くても「作者が自分の作品のコメントを非表示にする」機能は
-- そのまま動く。ポリシーを削除して、テーブルへの直接UPDATEはRPC以外の経路を
-- 塞ぐ（=作者であっても直接updateはできなくする）。

drop policy if exists "comments_update_by_work_author" on public.comments;
