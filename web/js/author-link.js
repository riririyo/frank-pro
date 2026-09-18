// frank pro — 作品カード左上の「作者名リンク」共通処理
//
// 以前はここに mado.html を踏襲した「● ● ●」という装飾ドットを置いていたが、
// 押せない飾りに見えてしまう上に作者ページへの導線が無かったため、
// 実際に押すと作者ページへ飛べる「作者名」のリンクに置き換えた。
// 一覧・履歴のように複数の作者の作品が混在する画面では、表示名をまとめて
// 引くために fetchDisplayNames() を使う（作品ごとに1件ずつ問い合わせない）。

import { supabase } from "./supabaseClient.js";

export async function fetchDisplayNames(authorIds) {
  const uniqueIds = [...new Set(authorIds)].filter(Boolean);
  if (!uniqueIds.length) return new Map();

  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", uniqueIds);

  if (error) {
    console.error(error);
    return new Map();
  }
  return new Map(data.map((p) => [p.id, p.display_name]));
}

// カード左上（サムネの「窓」の帯）に置く、作者ページへのリンク要素
export function buildWorkThumbAuthorLink(authorId, displayName) {
  const a = document.createElement("a");
  a.className = "work-thumb-author";
  a.href = `author.html?id=${authorId}`;
  a.textContent = displayName || "名無し";
  // カード自体のクリック（プレイ開始）と競合しないようにする
  a.addEventListener("click", (e) => e.stopPropagation());
  return a;
}
