// frank pro — ベイズ平均の m, C を再計算し、全作品の rating_bayes を更新する
//
// m = 全作品の票数の中央値（最低3、上限20でクランプ）
// C = サイト全体の重み付き平均点（Σ(avg×count) / Σcount）
// docs/security-design.md 2-3節 / docs/frank-pro-handoff.md 4章
//
// 式ひとつだが、並べ替えに直結するので変更は必ずこのファイル経由にする。

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const M_MIN = 3;
const M_MAX = 20;

async function main() {
  const { data: works, error } = await supabase
    .from("works")
    .select("id, rating_count, rating_avg")
    .eq("status", "published");

  if (error) throw error;

  const withVotes = works.filter((w) => w.rating_count > 0);

  const m = clamp(median(withVotes.map((w) => w.rating_count)) || M_MIN, M_MIN, M_MAX);

  const totalCount = withVotes.reduce((sum, w) => sum + w.rating_count, 0);
  const totalScore = withVotes.reduce((sum, w) => sum + w.rating_avg * w.rating_count, 0);
  const c = totalCount > 0 ? totalScore / totalCount : 3.5;

  console.log(`m=${m.toFixed(2)}, C=${c.toFixed(2)}, 対象作品=${works.length}件`);

  await supabase
    .from("site_stats")
    .update({ bayes_m: m, bayes_c: c, updated_at: new Date().toISOString() })
    .eq("id", true);

  // 1件ずつUPDATEすると作品数が増えたときに遅くなるので、まとめてPostgres関数側で計算させる
  const { error: rpcError } = await supabase.rpc("apply_bayesian_scores", { p_m: m, p_c: c });
  if (rpcError) throw rpcError;

  console.log("rating_bayes を更新しました");
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
