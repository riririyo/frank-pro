// frank pro — コメント投稿 Edge Function
//
// なぜクライアントから直接INSERTさせないのか:
// comments.ip_address / user_agent は発信者情報開示請求に応えるために必要な列で、
// クライアントの自己申告を信用するわけにはいかない（誰でも偽装できる）。
// この関数が service_role で実IPとUAを刻んでから挿入する。
// スパム対策やレート制限は意図的に入れていない（docs/security-design.md 3章の方針）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

  let body: { work_id?: string; visitor_id?: string; display_name?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const workId = (body.work_id ?? "").trim();
  const visitorId = (body.visitor_id ?? "").trim();
  const displayName = (body.display_name ?? "ななし").trim().slice(0, 40) || "ななし";
  const text = (body.body ?? "").trim();

  if (!workId || !visitorId) {
    return json({ error: "work_id and visitor_id are required" }, 400);
  }
  if (!text) {
    return json({ error: "empty comment" }, 400);
  }
  if (text.length > 500) {
    return json({ error: "comment too long (max 500 chars)" }, 400);
  }

  // Cloudflare Pages / Workers 経由なら cf-connecting-ip、それ以外は x-forwarded-for の先頭
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const { data, error } = await supabase
    .from("comments")
    .insert({
      work_id: workId,
      visitor_id: visitorId,
      display_name: displayName,
      body: text,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select("id, work_id, display_name, body, created_at")
    .single();

  if (error) {
    console.error(error);
    return json({ error: "insert failed" }, 500);
  }

  // IP/UAはレスポンスに含めない
  return json({ comment: data }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
