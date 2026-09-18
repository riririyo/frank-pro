-- frank pro — worksバケットを非公開化する（重要な脆弱性の修正）
--
-- 【見つかった問題】
-- worksバケットは public: true で作成されていた（0005_works_bucket.sql）。
-- publicバケットは
--   {SUPABASE_URL}/storage/v1/object/public/works/<id>.html
-- という認証不要のURLで誰でも直接取得できる。これはCloudflare Worker
-- （配信ヘッダを強制する層）を素通りできるということであり、
-- security-design.md 1章で最重要としているCSP sandboxヘッダが一切付かない
-- 状態でHTMLを直接開けてしまっていた。つまり:
--   - 「削除」してWorker側の配信を止めても、直リンクを知っていれば見られる
--   - 公開中の作品ですら、直リンクを踏めば隔離（opaque origin化）されずに開ける
--     （＝security-design.mdが最も警戒していた「配信ドメインの正規オリジンとして
--       動いてしまう」状態そのもの）
--
-- 【対応】
-- バケットをpublic: falseにし、誰でも読めるworks_bucket_select_allポリシーを
-- 削除する。これでこの直リンク経路は完全に塞がる。
--
-- ただしこれをやると、Cloudflare Worker（worker/src/index.js）が今まで通りの
-- 匿名fetchでは中身を取得できなくなる。worker側はservice_role keyで
-- 認証付きダウンロードに切り替える必要がある（このリポジトリのworker/src/index.js
-- は合わせて更新済み）。
--
-- ⚠️ このマイグレーションを適用する前に、必ず worker/README等の手順に従って
--    Cloudflare Worker側に SUPABASE_SERVICE_ROLE_KEY のシークレットを追加し、
--    新しいWorkerコードを先にデプロイしておくこと。順番を間違えると、
--    適用した瞬間にサイト上の全作品が再生できなくなる（詳しくはコミット
--    メッセージ・引き継ぎ資料を参照）。

update storage.buckets set public = false where id = 'works';

drop policy if exists "works_bucket_select_all" on storage.objects;

-- Workerはservice_role keyで読みに行くため、service_roleはRLSを常にバイパスする
-- （テーブル所有者と同様の扱い）ので、anon/authenticated向けの新しいSELECT
-- ポリシーは作らない＝Workerを経由しない限り誰も読めない状態になる。
