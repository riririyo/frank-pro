// frank pro — カードに表示するコメント件数の一括取得
//
// works側にコメント数の集計カラムは無い（comments.jsを参照）。
// 専用のRPC/集計カラムを増やすほどの規模ではないので、is_hidden=falseで
// 見えているコメントのwork_idだけをまとめて取ってきて、クライアント側で数える。
// （comments_select_visible RLSで元々誰でもselectできる情報なので、これ以上の
// 権限は必要ない）
// listing.js / author.js / history.js の3箇所から同じ関数を使う。

import { supabase } from "./supabaseClient.js";

export async function fetchCommentCounts(workIds) {
  const ids = [...new Set((workIds ?? []).filter(Boolean))];
  const counts = new Map();
  if (!ids.length) return counts;

  const { data, error } = await supabase.from("comments").select("work_id").in("work_id", ids);
  if (error) {
    console.error(error);
    return counts;
  }
  for (const row of data ?? []) {
    counts.set(row.work_id, (counts.get(row.work_id) ?? 0) + 1);
  }
  return counts;
}
