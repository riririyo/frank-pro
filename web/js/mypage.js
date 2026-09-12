// frank pro — マイページ（自分の投稿の管理：非公開切り替え・削除）
//
// author.html は「誰でも見られる公開プロフィールページ」（?id=<author_id>で他人も閲覧可）。
// こちらは逆に「ログイン中の自分専用」で、statusを問わず自分の全投稿を出し、
// 非公開化・削除（status変更）ができる。works_update_own / works_delete_own の
// RLSポリシー（0002_rls.sql）はすでに用意されているので、ここはUIを足すだけでよい。
//
// 「削除」は物理削除ではなくstatus='removed'への変更（guidelines.html 4-1と同じ運用）。

import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";

const STATUS_LABEL = {
  published: "公開中",
  hidden: "非公開",
  removed: "削除済み",
};

export async function initMyPage() {
  const user = await requireAuth();
  if (!user) return;

  await renderList(user.id);
}

async function renderList(userId) {
  const root = document.getElementById("mypage-root");

  const { data: works, error } = await supabase
    .from("works")
    .select("id, title, status, thumbnail_path, access_count, rating_count, rating_avg, created_at")
    .eq("author_id", userId)
    .order("created_at", { ascending: false });

  root.innerHTML = "<h1>マイページ</h1>";

  if (error) {
    root.innerHTML += "<p class='form-hint error'>読み込みに失敗しました。時間をおいて再度お試しください。</p>";
    return;
  }
  if (!works.length) {
    root.innerHTML += "<div class='empty-state'>まだ投稿がありません。</div>";
    return;
  }

  const list = document.createElement("div");
  list.className = "mypage-list";

  for (const w of works) {
    list.appendChild(buildItem(w, userId));
  }
  root.appendChild(list);
}

function buildItem(work, userId) {
  const item = document.createElement("div");
  item.className = "mypage-item" + (work.status === "removed" ? " is-removed" : "");

  const thumb = document.createElement("div");
  thumb.className = "mypage-thumb";
  if (work.thumbnail_path) {
    const img = document.createElement("img");
    img.src = work.thumbnail_path;
    img.loading = "lazy";
    img.alt = work.title;
    thumb.appendChild(img);
  }

  const body = document.createElement("div");
  body.className = "mypage-body";

  const title = document.createElement("div");
  title.className = "mypage-title";
  title.textContent = work.title;

  const stats = document.createElement("div");
  stats.className = "mypage-stats";
  const ratingText = work.rating_count > 0 ? `★ ${work.rating_avg.toFixed(1)}` : "評価なし";
  stats.textContent = `${ratingText} · ${work.access_count}回`;

  const badge = document.createElement("span");
  badge.className = `status-badge ${work.status}`;
  badge.textContent = STATUS_LABEL[work.status] ?? work.status;

  body.appendChild(title);
  body.appendChild(stats);
  body.appendChild(document.createElement("br"));
  body.appendChild(badge);

  if (work.status !== "removed") {
    const actions = document.createElement("div");
    actions.className = "mypage-actions";

    if (work.status === "published") {
      const viewLink = document.createElement("a");
      viewLink.className = "btn";
      viewLink.href = `index.html?work=${encodeURIComponent(work.id)}`;
      viewLink.textContent = "見る";
      actions.appendChild(viewLink);

      const hideBtn = document.createElement("button");
      hideBtn.className = "btn";
      hideBtn.textContent = "非公開にする";
      hideBtn.addEventListener("click", () => updateStatus(work.id, "hidden", userId));
      actions.appendChild(hideBtn);
    } else if (work.status === "hidden") {
      const showBtn = document.createElement("button");
      showBtn.className = "btn";
      showBtn.textContent = "公開する";
      showBtn.addEventListener("click", () => updateStatus(work.id, "published", userId));
      actions.appendChild(showBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger";
    deleteBtn.textContent = "削除する";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`「${work.title}」を削除します。この操作は元に戻せません。よろしいですか？`)) return;
      updateStatus(work.id, "removed", userId);
    });
    actions.appendChild(deleteBtn);

    body.appendChild(actions);
  }

  item.appendChild(thumb);
  item.appendChild(body);
  return item;
}

async function updateStatus(workId, status, userId) {
  const { error } = await supabase.from("works").update({ status }).eq("id", workId);
  if (error) {
    alert("更新に失敗しました。時間をおいて再度お試しください。");
    return;
  }
  await renderList(userId);
}
