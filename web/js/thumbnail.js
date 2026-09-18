// frank pro — サムネイル画像の共通処理（圧縮・アップロード）
//
// 投稿時（submit.js）と、投稿済み作品のサムネイルを後から変更するとき
// （mypage.js）の両方で同じ処理を使う。

export const THUMBNAIL_MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024; // 2MB（0004_storage.sqlのthumbnailsバケット上限と一致させる）
export const MAX_THUMBNAIL_RAW_SIZE = 20 * 1024 * 1024; // 圧縮前の元画像に対する上限（スマホの高解像度写真でも通るように余裕を持たせる）
export const THUMBNAIL_MAX_DIMENSION = 1600; // 圧縮後の最大辺（一覧のカードは小さいので十分な解像度）
export const THUMBNAIL_JPEG_QUALITY = 0.82;

// サムネイル画像をcanvasで縮小・再エンコードして、アップロード容量を抑える。
// 元画像がすでに小さい場合や、何らかの理由で圧縮に失敗した場合は元のファイルをそのまま返す。
export async function compressThumbnailImage(
  file,
  { maxDimension = THUMBNAIL_MAX_DIMENSION, quality = THUMBNAIL_JPEG_QUALITY } = {}
) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.src = objectUrl;
    });

    let { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) return file;

    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch (e) {
    console.error("thumbnail compress failed", e);
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// 圧縮済みのファイルをthumbnailsバケットにアップロードし、works.thumbnail_pathを更新する。
// thumbnails_insert_own_pathポリシー（0004_storage.sql）が先頭セグメント=自分のuidの
// パスにしかアップロードを許可しないため、パスはこの形にする。
// 失敗時は例外を投げるので、呼び出し側でハンドリングすること。
export async function uploadThumbnail(supabase, workId, userId, file) {
  const ext = THUMBNAIL_MIME_TO_EXT[file.type];
  const path = `${userId}/${workId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("thumbnails")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("thumbnails").getPublicUrl(path);

  const { error: updateError } = await supabase
    .from("works")
    .update({ thumbnail_path: publicUrlData.publicUrl, thumbnail_source: "author" })
    .eq("id", workId);
  if (updateError) throw updateError;

  return publicUrlData.publicUrl;
}
