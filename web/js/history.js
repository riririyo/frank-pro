// frank pro — 遊んだ履歴（history.html）
//
// ログイン不要。この端末のlocalStorageに保存された再生履歴（visitor.js）を元に、
// Supabaseから現在も公開中の作品情報だけを引いて一覧表示する。
// 非公開・削除済みになった作品は履歴からは自然に消える（DBに問い合わせないので）。

import { supabase } from "./supabaseClient.js";
import { openPlayer } from "./player.js";
import { getPlayHistory, clearPlayHistory } from "./visitor.js";
import { buildCardMenuButton } from "./card-menu.js";
import { buildWorkDescEl } from "./work-desc.js";
import { fetchDisplayNames, buildWorkThumbAuthorLink } from "./author-link.js";
import { fetchCommentCounts } from "./comment-count.js";

const GENRE_LABELS = { game: "ゲーム", product: "プロダクト" };

export async function initHistoryPage() {
  await renderHistoryPage();
}

async function renderHistoryPage() {
  const root = document.getElementById("history-root");
  if (!root) return;
  root.innerHTML = "<p class='form-hint'>読み込み中…</p>";

  const history = getPlayHistory();
  if (!history.length) {
    root.innerHTML = "<div class='empty-state'>まだ遊んだ作品がありません。一覧から気になる作品を遊んでみましょう。</div>";
    return;
  }

  const ids = history.map((e) => e.id);
  const { data: works, error } = await supabase
    .from("works")
    .select("id, title, description, thumbnail_path, category, access_count, rating_count, rating_avg, author_id")
    .in("id", ids)
    .eq("status", "published");

  root.innerHTML = "";

  if (error) {
    console.error(error);
    root.innerHTML = "<p class='form-hint error'>履歴を読み込めませんでした。時間をおいて再度お試しください。</p>";
    return;
  }

  const workMap = new Map((works ?? []).map((w) => [w.id, w]));
  const orderedWorks = history.map((e) => workMap.get(e.id)).filter(Boolean);

  const toolbar = document.createElement("div");
  toolbar.className = "history-toolbar";
  const countEl = document.createElement("span");
  countEl.className = "history-count";
  countEl.textContent = `${orderedWorks.length}件`;
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn";
  clearBtn.textContent = "履歴を消去";
  clearBtn.addEventListener("click", () => {
    if (!confirm("この端末に保存されているプレイ履歴を消去します。よろしいですか？")) return;
    clearPlayHistory();
    renderHistoryPage();
  });
  toolbar.appendChild(countEl);
  toolbar.appendChild(clearBtn);
  root.appendChild(toolbar);

  if (!orderedWorks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "公開中の履歴がありません（非公開・削除された作品は表示されません）。";
    root.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "work-grid";
  const [names, commentCounts] = await Promise.all([
    fetchDisplayNames(orderedWorks.map((w) => w.author_id)),
    fetchCommentCounts(orderedWorks.map((w) => w.id)),
  ]);
  for (const w of orderedWorks) grid.appendChild(buildCard(w, names, commentCounts));
  root.appendChild(grid);
}

function buildCard(work, authorNames, commentCounts) {
  const card = document.createElement("div");
  card.className = "work-card";
  card.addEventListener("click", () => openPlayer(work.id));

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "work-thumb-wrap";
  const thumb = document.createElement("div");
  thumb.className = "work-thumb";
  if (work.thumbnail_path) {
    const img = document.createElement("img");
    img.src = work.thumbnail_path;
    img.loading = "lazy";
    img.alt = work.title;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    thumb.appendChild(img);
  }
  thumbWrap.appendChild(thumb);

  if (work.author_id) {
    thumbWrap.appendChild(buildWorkThumbAuthorLink(work.author_id, authorNames?.get(work.author_id)));
  }

  if (GENRE_LABELS[work.category]) {
    const genreBadge = document.createElement("div");
    genreBadge.className = "genre-badge";
    genreBadge.textContent = GENRE_LABELS[work.category];
    thumbWrap.appendChild(genreBadge);
  }

  const meta = document.createElement("div");
  meta.className = "work-meta";

  const title = document.createElement("div");
  title.className = "work-title";
  title.textContent = work.title;

  const descEl = buildWorkDescEl(work.description);

  const stats = document.createElement("div");
  stats.className = "work-stats";
  const ratingText =
    work.rating_count > 0 ? `<span class="stars">★</span> ${work.rating_avg.toFixed(1)}` : "評価なし";
  const commentCount = commentCounts?.get(work.id) ?? 0;
  stats.innerHTML = `${ratingText}（💬 ${commentCount}）· ${work.access_count}回`;

  const metaRow = document.createElement("div");
  metaRow.className = "work-meta-row";
  metaRow.appendChild(stats);
  metaRow.appendChild(buildCardMenuButton(card, work));

  meta.appendChild(title);
  if (descEl) meta.appendChild(descEl);
  meta.appendChild(metaRow);

  card.appendChild(thumbWrap);
  card.appendChild(meta);
  return card;
}
