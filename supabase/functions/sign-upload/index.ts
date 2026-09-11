// frank pro — 投稿アップロード用 署名URL発行 Edge Function
//
// なぜR2への直接アップロードをさせないのか:
// クライアント直だとサイズ上限もMIMEチェックも迂回される。
// サイズと型はサーバー側でしか強制できない（docs/security-design.md 4章）。
//
// フロー:
//   1. ログイン済みユーザーがこの関数を呼ぶ（JWT必須。config.tomlでverify_jwt=true）
//   2. サイズ・拡張子を検証
//   3. works テーブルに status='published' で1行作る（file_pathを予約）
//   4. R2への PUT 用署名URLを発行して返す
//   5. クライアントはそのURLに直接PUTしてアップロードする
//
// 署名URLの発行には AWS S3 互換の SigV4 を使う（R2はS3互換API）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") ?? "frank-pro-works";

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB（docs/security-design.md, posting-guideline-draft.md）

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

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json({ error: "invalid session" }, 401);
  }
  const userId = userData.user.id;

  let body: { title?: string; description?: string; file_size_bytes?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const title = (body.title ?? "").trim().slice(0, 100);
  const description = (body.description ?? "").trim().slice(0, 2000);
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

  // work_id はDBのdefaultで発行される（連番にしない。docs/security-design.md 4章）。
  // ここでは先にidを採番してから、それをファイル名に使う。
  const workId = generateId();
  const objectKey = `works/${workId}.html`;

  const { error: insertError } = await supabase.from("works").insert({
    id: workId,
    author_id: userId,
    title,
    description,
    file_path: objectKey,
    file_size_bytes: fileSize,
    status: "published",
  });

  if (insertError) {
    console.error(insertError);
    return json({ error: "failed to create work record" }, 500);
  }

  const r2Endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });

  const putUrl = new URL(`${r2Endpoint}/${R2_BUCKET_NAME}/${objectKey}`);
  // 15分だけ有効な署名付きPUT URL
  const signed = await client.sign(
    new Request(putUrl, {
      method: "PUT",
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    { aws: { signQuery: true }, expiresIn: 900 } as any
  );

  return json(
    {
      work_id: workId,
      upload_url: signed.url,
      content_type: "text/html; charset=utf-8",
      max_size_bytes: MAX_SIZE_BYTES,
    },
    200
  );
});

function generateId(): string {
  // nanoid相当。連番にしない（下書き・非公開を先読みされないため）
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
