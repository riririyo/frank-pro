// frank pro — 作者ページ（作品一覧＋SNSリンク）
// URL例: author.html?id=<uuid>

import { supabase } from "./supabaseClient.js";
import { openPlayer } from "./player.js";
import { buildCardMenuButton } from "./card-menu.js";

const GENRE_LABELS = { game: "ゲーム", product: "プロダクト" };

export async function initAuthorPage() {
  const params = new URLSearchParams(location.search);
  const authorId = params.get("id");
  if (!authorId) {
    document.getElementById("author-root").innerHTML = "<p>作者が指定されていません。</p>";
    return;
  }

  const [{ data: profile }, { data: works, error }] = await Promise.all([
    supabase.from("profiles").select("display_name, bio, sns_links").eq("id", authorId).maybeSingle(),
    supabase
      .from("works")
      .select("id, title, thumbnail_path, category, access_count, rating_count, rating_avg")
      .eq("author_id", authorId)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
  ]);

  const root = document.getElementById("author-root");
  root.innerHTML = "";

  const header = document.createElement("div");
  header.innerHTML = `
    <h1>${escapeHtml(profile?.display_name ?? "名無し")}</h1>
    ${profile?.bio ? `<p>${escapeHtml(profile.bio)}</p>` : ""}
  `;
  if (profile?.sns_links?.length) {
    const links = document.createElement("div");
    links.style.display = "flex";
    links.style.gap = "12px";
    links.style.marginBottom = "24px";
    for (const link of profile.sns_links) {
      const a = document.createElement("a");
      a.href = link.url;
      a.textContent = link.platform;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      links.appendChild(a);
    }
    header.appendChild(links);
  }
  root.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "work-grid";
  if (error) {
    grid.innerHTML = "<p>読み込みに失敗しました。</p>";
  } else if (!works.length) {
    grid.innerHTML = "<div class='empty-state'>まだ投稿がありません。</div>";
  } else {
    for (const w of works) {
      const card = document.createElement("div");
      card.className = "work-card";
      card.addEventListener("click", () => openPlayer(w.id));
      const genreLabel = GENRE_LABELS[w.category];
      card.innerHTML = `
        <div class="work-thumb-wrap">
          <div class="work-thumb"></div>
          ${genreLabel ? `<div class="genre-badge">${genreLabel}</div>` : ""}
        </div>
        <div class="work-meta">
          <div class="work-title">${escapeHtml(w.title)}</div>
          <div class="work-meta-row">
            <div class="work-stats">${w.rating_count > 0 ? `★ ${w.rating_avg.toFixed(1)}` : "評価なし"} · ${w.access_count}回</div>
          </div>
        </div>
      `;
      card.querySelector(".work-meta-row").appendChild(buildCardMenuButton(card, w));
      grid.appendChild(card);
    }
  }
  root.appendChild(grid);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
