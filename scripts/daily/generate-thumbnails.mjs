// frank pro — サムネイル自動生成
//
// 対象: thumbnail_source = 'pending' の作品（作者が任意アップロードしなかったもの）
// docs/frank-pro-handoff.md 6章「サムネは3段構え」の3段目。
//
// 実際にWorkerが配信するURL（本番と同じCSP・sandbox条件）を開いてスクリーンショットを撮る。
// 常時ヘッドレスブラウザを動かすとGitHub Actionsの無料枠を超えるため、
// 1日1回のこのバッチで未処理分だけまとめて処理する。
//
// 撮影ビューポートはスマホ縦画面比（9:16）にしている。以前は800x600の横長
// ビューポートでそのまま撮っていたため、スマホ縦画面前提で作られたゲーム
// （ほとんどの作品がそう）は中央に小さく縦長で表示され、左右が黒い余白に
// なった状態でサムネイルになってしまっていた（一覧で「縦長の写真が混ざって
// いるバグ」に見える原因）。実際に遊ばれる比率で撮ってから、
// web/js/thumbnail-crop.js と同じ4:3に中央基準でクロップすることで、
// 手動アップロード時のサムネイルと見た目を揃えている。

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKS_BASE_URL = process.env.WORKS_BASE_URL; // 例: https://works.frank.pro
const THUMBNAILS_BUCKET = "thumbnails"; // Supabase Storage

// スマホでの実際のプレイ比率に近いビューポートで撮影する
const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 1138; // 640 * 16/9

// サムネイルの最終比率。web/js/thumbnail-crop.js の THUMB_ASPECT と合わせること
const THUMB_WIDTH = 640;
const THUMB_HEIGHT = 480; // 4:3

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const { data: works, error } = await supabase
    .from("works")
    .select("id")
    .eq("thumbnail_source", "pending")
    .eq("status", "published")
    .limit(200); // 1日の処理上限（無料枠対策）

  if (error) throw error;
  if (!works.length) {
    console.log("処理対象なし");
    return;
  }
  console.log(`${works.length}件のサムネイルを生成します`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT } });

  for (const work of works) {
    try {
      const url = `${WORKS_BASE_URL}/w/${work.id}.html`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(1500); // アニメーション等が始まるのを少し待つ
      // 縦長で撮った画面の縦中央から4:3を切り出す（クロップUIの中央基準デフォルトと同じ考え方）
      const buffer = await page.screenshot({
        type: "jpeg",
        quality: 80,
        clip: {
          x: 0,
          y: Math.max(0, (CAPTURE_HEIGHT - THUMB_HEIGHT) / 2),
          width: THUMB_WIDTH,
          height: THUMB_HEIGHT,
        },
      });

      const path = `${work.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(THUMBNAILS_BUCKET)
        .upload(path, buffer, { contentType: "image/jpeg", upsert: true });

      if (uploadError) throw uploadError;

      const { data: publicUrl } = supabase.storage.from(THUMBNAILS_BUCKET).getPublicUrl(path);

      await supabase
        .from("works")
        .update({ thumbnail_path: publicUrl.publicUrl, thumbnail_source: "auto" })
        .eq("id", work.id);

      console.log(`OK: ${work.id}`);
    } catch (e) {
      // 1件失敗しても他の処理は続ける。重い/壊れた作品は撮れないことがある
      console.error(`FAILED: ${work.id}`, e.message);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
