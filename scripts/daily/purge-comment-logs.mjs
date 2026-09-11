// frank pro — 6ヶ月を過ぎたコメントの発信者情報（IP/UA）を削除する
//
// コメント本文自体は消さない。消すのは開示請求対応のためだけに保存していたIP/UAだけ。
// docs/security-design.md 3-3節「保存期間6ヶ月。以降は日次バッチで自動削除」

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;

async function main() {
  const cutoff = new Date(Date.now() - SIX_MONTHS_MS).toISOString();

  const { data, error } = await supabase
    .from("comments")
    .update({ ip_address: null, user_agent: null })
    .lt("created_at", cutoff)
    .not("ip_address", "is", null)
    .select("id");

  if (error) throw error;

  console.log(`${data?.length ?? 0}件のコメントからIP/UAを削除しました（${cutoff} より前）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
