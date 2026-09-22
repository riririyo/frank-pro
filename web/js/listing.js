// frank pro — 一覧（グリッド）
//
// 並べ替え4種: 新規 / アクセス数 / 評価数 / 評価率
// docs/frank-pro-handoff.md 3章・4章

import { supabase } from "./supabaseClient.js";
import { openPlayer } from "./player.js";
import { getPlayedIds } from "./visitor.js";
import { buildCardMenuButton } from "./card-menu.js";
import { buildWorkDescEl } from "./work-desc.js";
import { fetchDisplayNames, buildWorkThumbAuthorLink } from "./author-link.js";
import { fetchCommentCounts } from "./comment-count.js";
import { OPERATION_TAGS, CONTENT_TAGS } from "./tags.js";

const PAGE_SIZE = 24;

const GENRE_LABELS = { game: "ゲーム", product: "プロダクト" };

// ジャンル絞り込み。「すべて」はcategoryで絞らない特別扱い
const GENRE_FILTERS = [
  { key: "all", label: "すべて" },
  { key: "game", label: "ゲーム" },
  { key: "product", label: "プロダクト" },
];

// 初期表示は「アクセス数」順（新規順だと0本〜数本の時期に荒れやすいため）。
// 並び順自体は引き続き4種から選べる
const SORT_OPTIONS = [
  { key: "access", label: "アクセス数", column: "access_count", ascending: false },
  { key: "new", label: "新規", column: "created_at", ascending: false },
  { key: "rating_count", label: "評価数", column: "rating_count", ascending: false },
  { key: "rating_bayes", label: "評価率", column: "rating_bayes", ascending: false },
];

let currentSort = SORT_OPTIONS[0];
let currentGenre = GENRE_FILTERS[0];
let currentOffset = 0;
let loading = false;
let reachedEnd = false;
const currentTags = new Set();

export function initListing() {
  const tabsEl = document.getElementById("sort-tabs");
  tabsEl.innerHTML = "";
  for (const opt of SORT_OPTIONS) {
    const btn = document.createElement("button");
    btn.className = "sort-tab";
    btn.textContent = opt.label;
    btn.setAttribute("aria-selected", opt.key === currentSort.key ? "true" : "false");
    btn.addEventListener("click", () => switchSort(opt));
    tabsEl.appendChild(btn);
  }

  const genreTabsEl = document.getElementById("genre-tabs");
  if (genreTabsEl) {
    genreTabsEl.innerHTML = "";
    for (const opt of GENRE_FILTERS) {
      const btn = document.createElement("button");
      btn.className = "genre-tab";
      btn.textContent = opt.label;
      btn.setAttribute("aria-selected", opt.key === currentGenre.key ? "true" : "false");
      btn.addEventListener("click", () => switchGenre(opt));
      genreTabsEl.appendChild(btn);
    }
  }

  renderTagFilters();

  window.addEventListener("scroll", () => {
    if (loading || reachedEnd) return;
    const nearBottom =
      window.innerHeight + window.scrollY >= document.body.offsetHeight - 600;
    if (nearBottom) loadMore();
  });

  loadInitial();
}

function switchSort(opt) {
  currentSort = opt;
  currentOffset = 0;
  reachedEnd = false;
  document
    .querySelectorAll(".sort-tab")
    .forEach((el) => el.setAttribute("aria-selected", el.textContent === opt.label ? "true" : "false"));
  loadInitial();
}

function renderTagFilters() {
  const groupEl = document.getElementById("tag-filter-group");
  if (!groupEl) return;
  groupEl.innerHTML = "";

  const buildRow = (label, tags) => {
    const row = document.createElement("div");
    row.className = "tag-filter-row";
    const labelEl = document.createElement("span");
    labelEl.className = "tag-filter-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const tabsEl = document.createElement("div");
    tabsEl.className = "tag-filter-tabs";
    for (const tag of tags) {
      const btn = document.createElement("button");
      btn.className = "tag-filter-tab";
      btn.textContent = tag.label;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => toggleTagFilter(tag.value, btn));
      tabsEl.appendChild(btn);
    }
    row.appendChild(tabsEl);
    return row;
  };

  groupEl.appendChild(buildRow("操作環境", OPERATION_TAGS));
  groupEl.appendChild(buildRow("内容", CONTENT_TAGS));
}

function toggleTagFilter(value, btn) {
  if (currentTags.has(value)) {
    currentTags.delete(value);
    btn.setAttribute("aria-pressed", "false");
  } else {
    currentTags.add(value);
    btn.setAttribute("aria-pressed", "true");
  }
  currentOffset = 0;
  reachedEnd = false;
  loadInitial();
}

function switchGenre(opt) {
  currentGenre = opt;
  currentOffset = 0;
  reachedEnd = false;
  document
    .querySelectorAll(".genre-tab")
    .forEach((el) => el.setAttribute("aria-selected", el.textContent === opt.label ? "true" : "false"));
  loadInitial();
}

async function loadInitial() {
  const grid = document.getElementById("work-grid");
  grid.innerHTML = "<div class='loading-state'>読み込み中…</div>";
  currentOffset = 0;
  reachedEnd = false;
  const works = await fetchPage();
  grid.innerHTML = "";
  if (works.length === 0) {
    grid.innerHTML = "<div class='empty-state'>まだ作品がありません。最初の投稿者になりませんか？</div>";
    return;
  }
  const [names, commentCounts] = await Promise.all([
    fetchDisplayNames(works.map((w) => w.author_id)),
    fetchCommentCounts(works.map((w) => w.id)),
  ]);
  for (const w of works) grid.appendChild(buildCard(w, names, commentCounts));
  currentOffset = works.length;
}

async function loadMore() {
  loading = true;
  const works = await fetchPage();
  const grid = document.getElementById("work-grid");
  const [names, commentCounts] = await Promise.all([
    fetchDisplayNames(works.map((w) => w.author_id)),
    fetchCommentCounts(works.map((w) => w.id)),
  ]);
  for (const w of works) grid.appendChild(buildCard(w, names, commentCounts));
  currentOffset += works.length;
  if (works.length < PAGE_SIZE) reachedEnd = true;
  loading = false;
}

async function fetchPage() {
  loading = true;
  let query = supabase
    .from("works")
    .select(
      "id, title, description, thumbnail_path, category, access_count, rating_count, rating_avg, rating_bayes, created_at, author_id"
    )
    .eq("status", "published");

  if (currentGenre.key !== "all") {
    query = query.eq("category", currentGenre.key);
  }
  if (currentTags.size > 0) {
    query = query.contains("tags", [...currentTags]);
  }

  const { data, error } = await query
    .order(currentSort.column, { ascending: currentSort.ascending })
    .range(currentOffset, currentOffset + PAGE_SIZE - 1);

  loading = false;
  if (error) {
    console.error(error);
    return [];
  }
  return data ?? [];
}

function buildCard(work, authorNames, commentCounts) {
  const played = getPlayedIds();

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
  } else {
    thumb.textContent = "";
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

  if (played.has(work.id)) {
    const badge = document.createElement("div");
    badge.className = "played-badge";
    badge.textContent = "プレイ済み";
    thumbWrap.appendChild(badge);
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
