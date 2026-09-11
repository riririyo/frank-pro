-- frank pro — 投稿HTML本体のストレージバケット
--
-- もともとCloudflare R2に置く設計だったが、R2は無料枠でもカード登録が必須で
-- 超過時に上限なく自動課金される。個人開発の初期段階ではリスクが見合わないため、
-- カード登録不要で超過時は課金ではなく制限がかかるSupabase Storageに変更した。
-- 経緯: docs/security-design.md 1-1節末尾
--
-- 配信は必ず worker/ 経由（Cloudflare Workerがセキュリティヘッダを強制する）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('works', 'works', true, 5242880, array['text/html'])
on conflict (id) do nothing;

-- 閲覧は誰でも可（作品配信のため、Workerがサーバー間フェッチで読みに行く）
create policy "works_bucket_select_all" on storage.objects
  for select using (bucket_id = 'works');

-- 直接のINSERT/UPDATE/DELETEを許可するポリシーは意図的に作らない。
-- アップロードは sign-upload Edge Function が発行する署名付きURL
-- （service_roleがRLSを迂回して発行するcreateSignedUploadUrl）経由のみ。
