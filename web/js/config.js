// frank pro — 実行時設定
//
// ここに書く値はすべて「公開されて構わない」ものだけ（anon keyは公開前提のキー）。
// service_role キーやストレージのシークレットは絶対にここに書かない
// （それらは supabase/functions/* の環境変数として設定する）。
//
// デプロイ時にこのファイルの値を実際のプロジェクトのものに差し替える。

export const CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",

  // Cloudflare Worker が作品HTMLを配信するドメイン（サイト本体とは別ドメインにする）
  // docs/security-design.md 1-1節: 配信ドメインを本体から分けるのが前提
  WORKS_BASE_URL: "https://works.frank.pro",

  // Supabase Edge Functions のURL
  SUBMIT_COMMENT_URL: "https://YOUR-PROJECT-REF.supabase.co/functions/v1/submit-comment",
  SIGN_UPLOAD_URL: "https://YOUR-PROJECT-REF.supabase.co/functions/v1/sign-upload",

  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
};
