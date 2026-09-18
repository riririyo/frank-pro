// frank pro — 管理操作 Edge Function
//
// 管理画面（web/admin.html）から呼ばれる。やれることを1つの関数にまとめて、
// デプロイ・シークレット管理の手間を増やさないようにしている。
//
// すべての操作の前に、呼び出したJWTのユーザーが profiles.is_admin = true か
// service_roleで確認する。管理者以外は問答無用で403。
//
// action:
//   set_work_status   { work_id, status }         作品のstatusを変更（published/hidden/removed）
//   delete_work_file  { work_id }                 Storageの実ファイルを完全に削除する（status='removed'にもする）
//                                                  ※ Cloudflare Worker側のエッジキャッシュ（最大1時間）が
//                                                    残っている間は、そちらが消えるまで配信され続ける可能性がある。
//                                                    緊急時はCloudflare側のキャッシュも手動でパージすること。
//   set_user_ban      { user_id, banned }          アカウントのBAN/解除
//   hide_all_user_works { user_id }                そのユーザーの全作品を一括で非表示にする（BAN時によく使う）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WORKS_BUCKET = "works";
const VALID_STATUS = ["published", "hidden", "removed"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // 本番では frank pro の実ドメインに絞る
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json({ error: "invalid session" }, 401);
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!callerProfile?.is_admin) {
    return json({ error: "forbidden" }, 403);
  }

  let body: {
    action?: string;
    work_id?: string;
    status?: string;
    user_id?: string;
    banned?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  switch (body.action) {
    case "set_work_status": {
      if (!body.work_id || !VALID_STATUS.includes(body.status ?? "")) {
        return json({ error: "work_id and valid status are required" }, 400);
      }
      const { error } = await supabase
        .from("works")
        .update({ status: body.status })
        .eq("id", body.work_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true }, 200);
    }

    case "delete_work_file": {
      if (!body.work_id) {
        return json({ error: "work_id is required" }, 400);
      }
      const { data: work } = await supabase
        .from("works")
        .select("file_path")
        .eq("id", body.work_id)
        .maybeSingle();
      if (!work) return json({ error: "not found" }, 404);

      const { error: removeError } = await supabase.storage
        .from(WORKS_BUCKET)
        .remove([work.file_path]);
      if (removeError) {
        console.error(removeError);
        return json({ error: "failed to delete file" }, 500);
      }

      await supabase.from("works").update({ status: "removed" }).eq("id", body.work_id);
      return json({ ok: true }, 200);
    }

    case "set_user_ban": {
      if (!body.user_id || typeof body.banned !== "boolean") {
        return json({ error: "user_id and banned(boolean) are required" }, 400);
      }
      const { error } = await supabase
        .from("profiles")
        .update({ is_banned: body.banned })
        .eq("id", body.user_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true }, 200);
    }

    case "hide_all_user_works": {
      if (!body.user_id) {
        return json({ error: "user_id is required" }, 400);
      }
      const { error } = await supabase
        .from("works")
        .update({ status: "hidden" })
        .eq("author_id", body.user_id)
        .eq("status", "published");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true }, 200);
    }

    default:
      return json({ error: "unknown action" }, 400);
  }
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
