-- frank pro — サムネイル用ストレージバケット
-- 投稿HTML本体は別バケット（works。0005_works_bucket.sql）に置き、配信は
-- 別ドメインのCloudflare Worker経由でCSP隔離する。
-- サムネイル画像は無害な静的画像なので、このバケットは公開直配信で十分（docs/frank-pro-handoff.md 8章）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thumbnails', 'thumbnails', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- 投稿者は自分のuidを先頭に含むパスにのみアップロードできる: thumbnails/<uid>/<work_id>.jpg
create policy "thumbnails_insert_own_path" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "thumbnails_update_own_path" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 閲覧は誰でも可（一覧のサムネ表示のため）
create policy "thumbnails_select_all" on storage.objects
  for select using (bucket_id = 'thumbnails');
