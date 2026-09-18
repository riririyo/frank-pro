// frank pro — 実行時設定
//
// ここに書く値はすべて「公開されて構わない」ものだけ（anon keyは公開前提のキー）。
// service_role キーやストレージのシークレットは絶対にここに書かない
// （それらは supabase/functions/* の環境変数として設定する）。
//
// デプロイ時にこのファイルの値を実際のプロジェクトのものに差し替える。

export const CONFIG = {
    SUPABASE_URL: "https://tvaadeaojsolxsmmyznz.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2YWFkZWFvanNvbHhzbW15em56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzcxMTQsImV4cCI6MjEwNDcxMzExNH0.dpMwe2MsRsiPnpJzNRuTZaGIdrnb34ZpEtpKHm_rtUk",

    // Cloudflare Worker が作品HTMLを配信するドメイン（サイト本体とは別ドメインにする）
    // docs/security-design.md 1-1節: 配信ドメインを本体から分けるのが前提
    WORKS_BASE_URL: "https://frank-pro-works.rimocon-rimocon-rimocon.workers.dev",

    // Supabase Edge Functions のURL
    SUBMIT_COMMENT_URL: "https://tvaadeaojsolxsmmyznz.supabase.co/functions/v1/submit-comment",
    SIGN_UPLOAD_URL: "https://tvaadeaojsolxsmmyznz.supabase.co/functions/v1/sign-upload",
    TRIGGER_THUMBNAIL_URL: "https://tvaadeaojsolxsmmyznz.supabase.co/functions/v1/trigger-thumbnail",
    ADMIN_ACTION_URL: "https://tvaadeaojsolxsmmyznz.supabase.co/functions/v1/admin-action",

    MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
};
