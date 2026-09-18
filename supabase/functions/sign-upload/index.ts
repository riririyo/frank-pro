// frank pro — 投稿アップロード用 署名URL発行 Edge Function
//
// なぜストレージへの直接アップロードをさせないのか:
// クライアント直だとサイズ上限もMIMEチェックも迂回される。
// サイズと型はサーバー側でしか強制できない（docs/security-design.md 4章）。
//
// ストレージにR2ではなくSupabase Storageを使っている理由: docs/security-design.md 1-1節末尾
// （個人開発の初期段階ではカード登録不要・超過時に自動課金されない方を優先した）
//
// フロー:
//   1. ログイン済みユーザーがこの関数を呼ぶ（JWT必須。config.tomlでverify_jwt=true）
//   2. サイズ・拡張子を検証
//   3. works テーブルに status='published' で1行作る（file_pathを予約）
//   4. Supabase Storageの署名付きアップロードURL（token）を発行して返す
//   5. クライアントは supabase.storage.uploadToSignedUrl() でそtokenを使って直接アップロードする

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WORKS_BUCKET = "works";
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB（docs/security-design.md, posting-guideline-draft.md）
const VALID_CATEGORIES = ["game", "product"];

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
  const jwt = authHeader.replace(/^Bearers+/i, "");
  if (!jwt) {
    return json({ error: "authorization required" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json({ error: "invalid session" }, 401);
  }
  const userId = userData.user.id;

  // BANされたユーザーは新規投稿できない
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_banned")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.is_banned) {
    return json({ error: "このアカウントは投稿を停止されています" }, 403);
  }

  let body: { title?: string; description?: string; category?: string; file_size_bytes?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const title = (body.title ?? "").trim().slice(0, 100);
  const description = (body.description ?? "").trim().slice(0, 2000);
  const category = VALID_CATEGORIES.includes(body.category ?? "") ? body.category! : "game";
  const fileSize = Number(body.file_size_bytes ?? 0);

  if (!title) {
    return json({ error: "title is required" }, 400);
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return json({ error: "file_size_bytes is required" }, 400);
  }
  if (fileSize > MAX_SIZE_BYTES) {
    return json({ error: `file too large: max ${MAX_SIZE_BYTES} bytes (5MB)` }, 413);
  }

  // work_id はここで先に採番してから、それをファイル名に使う（連番にしない。docs/security-design.md 4章）。
  const workId = generateId();
  const objectPath = `${workId}.html`;

  const { error: insertError } = await supabase.from("works").insert({
    id: workId,
    author_id: userId,
    title,
    description,
    category,
    file_path: objectPath,
    file_size_bytes: fileSize,
    status: "published",
  });

  if (insertError) {
    console.error(insertError);
    return json({ error: "failed to create work record" }, 500);
  }

  // service_role なのでRLSに関係なく発行できる。tokenは1回限り・短時間のみ有効
  const { data: signed, error: signError } = await supabase.storage
    .from(WORKS_BUCKET)
    .createSignedUploadUrl(objectPath);

  if (signError || !signed) {
    console.error(signError);
    return json({ error: "failed to create upload url" }, 500);
  }

  return json(
    {
      work_id: workId,
      bucket: WORKS_BUCKET,
      path: objectPath,
      token: signed.token,
      content_type: "text/html; charset=utf-8",
      max_size_bytes: MAX_SIZE_BYTES,
    },
    200
  );
});

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replace(/+/g, "-")
    .replace(///g, "_")
    .replace(/=+$/, "");
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
