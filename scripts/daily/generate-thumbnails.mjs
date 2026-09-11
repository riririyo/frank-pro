// frank pro — サムネイル自動生成
//
// 対象: thumbnail_source = 'pending' の作品（作者が任意アップロードしなかったもの）
// docs/frank-pro-handoff.md 6章「サムネは3段構え」の3段目。
//
// 実際にWorkerが配信するURL（本番と同じCSP・sandbox条件）を開いてスクリーンショットを撮る。
// 常時ヘッドレスブラウザを動かすとGitHub Actionsの無料枠を超えるため、
// 1日1回のこのバッチで未処理分だけまとめて処理する。

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKS_BASE_URL = process.env.WORKS_BASE_URL; // 例: https://works.frank.pro
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "frank-pro-works";
const THUMBNAILS_BUCKET = "thumbnails"; // Supabase Storage

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
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

  for (const work of works) {
    try {
      const url = `${WORKS_BASE_URL}/w/${work.id}.html`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(1500); // アニメーション等が始まるのを少し待つ
      const buffer = await page.screenshot({ type: "jpeg", quality: 80 });

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
