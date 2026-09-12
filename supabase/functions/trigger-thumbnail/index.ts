// frank pro — 投稿直後にサムネイル自動生成バッチを即時起動する Edge Function
//
// なぜsign-upload自体からではなく、これを別関数にしたのか:
// sign-upload の時点ではまだ本体HTMLファイルがStorageにアップロードされていない
// （アップロードはクライアントがsupabase.storage.uploadToSignedUrl()で別途行う）。
// その前にサムネ生成バッチ（Playwrightでworks配信URLを開いてスクショを撮る）を
// 起動しても404で失敗するだけなので、クライアントがファイル本体のアップロードを
// 終えた後にこちらを呼ぶ構成にしている（web/js/submit.js）。
//
// GitHub Actionsの daily-batch ワークフロー（.github/workflows/daily.yml）を
// workflow_dispatch で即時起動する。thumbnails_only=true を渡すことで、
// ベイズ再計算・古いログ削除はスキップしてサムネ生成だけ走らせる。
//
// 本人が自分でサムネイルをアップロードしていた場合（thumbnail_source='author'）は
// 起動そのものをスキップする。バッチ側もthumbnail_source='pending'の作品しか
// 処理しないので、仮に呼んでしまっても上書きされることはない（二重の安全策）。
//
// GH_DISPATCH_TOKEN が未設定の場合は何もしない。投稿自体は失敗させたくないので、
// このEdge Function自体は常に200を返す（実際に起動できたかはskippedで示す）。
//
// 事前にSupabaseのEdge Function Secretsで以下を登録すること:
//   GH_DISPATCH_TOKEN … frank-proリポジトリの Actions:write 権限を持つGitHubトークン
//   GH_REPO（任意）… 既定値 "riririyo/frank-pro"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GH_DISPATCH_TOKEN = Deno.env.get("GH_DISPATCH_TOKEN");
const GH_REPO = Deno.env.get("GH_REPO") ?? "riririyo/frank-pro";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // 本番では frank pro の実ドメインに絞る
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return json({ error: "authorization required" }, 401);
  }

  let body: { work_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const workId = (body.work_id ?? "").trim();
  if (!workId) {
    return json({ error: "work_id is required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json({ error: "invalid session" }, 401);
  }

  // 他人の作品IDを渡してのActions乱用を防ぐため、本人の作品かどうかだけ確認する
  const { data: work } = await supabase
    .from("works")
    .select("id, author_id, thumbnail_source")
    .eq("id", workId)
    .maybeSingle();

  if (!work || work.author_id !== userData.user.id) {
    return json({ error: "not found" }, 404);
  }

  if (work.thumbnail_source !== "pending") {
    // 自分でサムネイルを設定済みなら起動不要
    return json({ ok: true, skipped: true }, 200);
  }

  if (!GH_DISPATCH_TOKEN) {
    console.warn("GH_DISPATCH_TOKEN not set; skip instant thumbnail trigger");
    return json({ ok: true, skipped: true }, 200);
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/daily.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GH_DISPATCH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main", inputs: { thumbnails_only: "true" } }),
      }
    );
    if (!res.ok) {
      console.error("workflow dispatch failed", res.status, await res.text());
      return json({ ok: true, skipped: true }, 200);
    }
  } catch (e) {
    console.error("workflow dispatch fetch failed", e);
    return json({ ok: true, skipped: true }, 200);
  }

  return json({ ok: true, skipped: false }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
