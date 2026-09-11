// frank pro — 星評価
//
// 方針（docs/security-design.md 2章）: 匿名票も認証票も同じ重み。
// Turnstileも異常検知もレート制限も入れない。ベイズ平均だけが並び順の防御。

import { supabase } from "./supabaseClient.js";
import { getVisitorId } from "./visitor.js";

export async function renderRatingWidget(container, workId) {
  if (!container) return;
  const visitorId = getVisitorId();

  const [{ data: work }, { data: myRating }] = await Promise.all([
    supabase.from("works").select("rating_count, rating_avg").eq("id", workId).single(),
    supabase
      .from("ratings")
      .select("score")
      .eq("work_id", workId)
      .eq("visitor_id", visitorId)
      .maybeSingle(),
  ]);

  let currentScore = myRating?.score ?? 0;

  container.innerHTML = "";
  const widget = document.createElement("div");
  widget.className = "rating-widget";

  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "★";
    btn.setAttribute("aria-label", `${i}点`);
    if (i <= currentScore) btn.classList.add("filled");
    btn.addEventListener("click", async () => {
      currentScore = i;
      [...widget.querySelectorAll("button")].forEach((b, idx) => {
        b.classList.toggle("filled", idx < i);
      });
      const { error } = await supabase.rpc("upsert_rating", {
        p_work_id: workId,
        p_visitor_id: visitorId,
        p_score: i,
      });
      if (error) {
        console.error(error);
        return;
      }
      const { data: updated } = await supabase
        .from("works")
        .select("rating_count, rating_avg")
        .eq("id", workId)
        .single();
      updateSummary(summary, updated);
    });
    widget.appendChild(btn);
  }

  const summary = document.createElement("span");
  summary.className = "rating-summary";
  updateSummary(summary, work);

  container.appendChild(widget);
  container.appendChild(summary);
}

function updateSummary(el, work) {
  if (!work) {
    el.textContent = "評価なし";
    return;
  }
  const count = work.rating_count ?? 0;
  const avg = work.rating_avg ?? 0;
  el.textContent = count > 0 ? `${avg.toFixed(1)}（${count}件）` : "評価なし";
}
