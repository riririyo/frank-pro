// frank pro — 作者ページ（作品一覧＋SNSリンク）
// URL例: author.html?id=<uuid>

import { supabase } from "./supabaseClient.js";
import { openPlayer } from "./player.js";
import { buildCardMenuButton } from "./card-menu.js";
import { buildWorkDescEl } from "./work-desc.js";
import { buildWorkThumbAuthorLink } from "./author-link.js";
import { fetchCommentCounts } from "./comment-count.js";

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
      .select("id, title, description, thumbnail_path, category, access_count, rating_count, rating_avg, author_id")
      .eq("author_id", authorId)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
  ]);

  const root = document.getElementById("author-root");
  root.innerHTML = "";

  const header = document.createElement("div");
  const nameEl = document.createElement("h1");
  nameEl.textContent = profile?.display_name ?? "名無し";
  header.appendChild(nameEl);
  if (profile?.bio) {
    const bioEl = document.createElement("p");
    bioEl.textContent = profile.bio;
    header.appendChild(bioEl);
  }
  if (profile?.sns_links?.length) {
    const links = document.createElement("div");
    links.style.display = "flex";
    links.style.gap = "12px";
    links.style.marginBottom = "24px";
    for (const link of profile.sns_links) {
      // sns_linksはprofiles.update()で直接書き込めるため、保存時のバリデーション
      // （mypage.js）を経由していない値が来る可能性がある。javascript:等の
      // 危険なスキームを踏まないよう、表示側でもhttp/https以外は弾く
      if (!isHttpUrl(link.url)) continue;
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
    const commentCounts = await fetchCommentCounts(works.map((w) => w.id));
    for (const w of works) {
      grid.appendChild(buildWorkCard(w, profile?.display_name, commentCounts));
    }
  }
  root.appendChild(grid);
}

// このページの作品はすべて同じ作者なので、一覧(listing.js)のように作者名を
// 1件ずつ問い合わせる必要はなく、既に取得済みのdisplay_nameをそのまま使う。
// 以前はここで<div class="work-thumb"></div>を空のまま作っていたため
// サムネイル画像が一切表示されないバグがあった（thumbnail_pathは取得済みなのに使っていなかった）
function buildWorkCard(work, displayName, commentCounts) {
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
    thumbWrap.appendChild(buildWorkThumbAuthorLink(work.author_id, displayName));
  }

  const genreLabel = GENRE_LABELS[work.category];
  if (genreLabel) {
    const genreBadge = document.createElement("div");
    genreBadge.className = "genre-badge";
    genreBadge.textContent = genreLabel;
    thumbWrap.appendChild(genreBadge);
  }

  const meta = document.createElement("div");
  meta.className = "work-meta";

  const title = document.createElement("div");
  title.className = "work-title";
  title.textContent = work.title;
  meta.appendChild(title);

  const descEl = buildWorkDescEl(work.description);
  if (descEl) meta.appendChild(descEl);

  const stats = document.createElement("div");
  stats.className = "work-stats";
  const commentCount = commentCounts?.get(work.id) ?? 0;
  const ratingLabel = work.rating_count > 0 ? `★ ${work.rating_avg.toFixed(1)}` : "評価なし";
  stats.textContent = `${ratingLabel}（💬 ${commentCount}）· ${work.access_count}回`;

  const metaRow = document.createElement("div");
  metaRow.className = "work-meta-row";
  metaRow.appendChild(stats);
  metaRow.appendChild(buildCardMenuButton(card, work));
  meta.appendChild(metaRow);

  card.appendChild(thumbWrap);
  card.appendChild(meta);
  return card;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
