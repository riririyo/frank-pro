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

  await renderPage(user.id);
}

async function renderPage(userId) {
  const root = document.getElementById("mypage-root");
  root.innerHTML = "<h1>マイページ</h1>";

  const [{ data: profile }, { data: works, error }] = await Promise.all([
    supabase.from("profiles").select("display_name, bio, sns_links").eq("id", userId).maybeSingle(),
    supabase
      .from("works")
      .select("id, title, status, thumbnail_path, access_count, rating_count, rating_avg, created_at")
      .eq("author_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  root.appendChild(buildProfileSection(profile, userId));

  const worksHeading = document.createElement("h2");
  worksHeading.className = "mypage-section-heading";
  worksHeading.textContent = "投稿した作品";
  root.appendChild(worksHeading);

  if (error) {
    const errorEl = document.createElement("p");
    errorEl.className = "form-hint error";
    errorEl.textContent = "読み込みに失敗しました。時間をおいて再度お試しください。";
    root.appendChild(errorEl);
    return;
  }
  if (!works.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "まだ投稿がありません。";
    root.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "mypage-list";

  for (const w of works) {
    list.appendChild(buildItem(w, userId));
  }
  root.appendChild(list);
}

// プロフィール編集フォーム（表示名・自己紹介・SNSリンク）を組み立てる。
// author.html（公開プロフィールページ）に表示される情報をここで編集できる。
function buildProfileSection(profile, userId) {
  const section = document.createElement("section");
  section.className = "profile-edit";

  const heading = document.createElement("h2");
  heading.className = "mypage-section-heading";
  heading.textContent = "プロフィール";
  section.appendChild(heading);

  const nameField = document.createElement("div");
  nameField.className = "form-field";
  nameField.innerHTML = `
    <label for="display-name-input">表示名</label>
    <input id="display-name-input" type="text" maxlength="50" />
  `;
  section.appendChild(nameField);
  const displayNameInput = nameField.querySelector("#display-name-input");
  displayNameInput.value = profile?.display_name ?? "";

  const bioField = document.createElement("div");
  bioField.className = "form-field";
  bioField.innerHTML = `
    <label for="bio-input">自己紹介（作者ページに表示されます）</label>
    <textarea id="bio-input" rows="3" maxlength="300"></textarea>
  `;
  section.appendChild(bioField);
  const bioInput = bioField.querySelector("#bio-input");
  bioInput.value = profile?.bio ?? "";

  const linksField = document.createElement("div");
  linksField.className = "form-field";
  linksField.innerHTML = "<label>SNSリンク</label>";
  const linksList = document.createElement("div");
  linksList.className = "sns-links-list";
  linksField.appendChild(linksList);

  const initialLinks = profile?.sns_links?.length ? profile.sns_links : [{ platform: "", url: "" }];
  for (const link of initialLinks) addSnsLinkRow(linksList, link);

  const addLinkBtn = document.createElement("button");
  addLinkBtn.type = "button";
  addLinkBtn.className = "btn";
  addLinkBtn.textContent = "＋ リンクを追加";
  addLinkBtn.addEventListener("click", () => addSnsLinkRow(linksList));
  linksField.appendChild(addLinkBtn);
  section.appendChild(linksField);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "プロフィールを保存";
  section.appendChild(saveBtn);

  const saveHint = document.createElement("p");
  saveHint.className = "form-hint";
  section.appendChild(saveHint);

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    const displayName = displayNameInput.value.trim() || "名無し";
    const bio = bioInput.value.trim();

    const rawLinks = [...linksList.querySelectorAll(".sns-link-row")].map((row) => ({
      platform: row.querySelector(".sns-platform-input").value.trim(),
      url: row.querySelector(".sns-url-input").value.trim(),
    }));
    const filledLinks = rawLinks.filter((link) => link.platform && link.url);
    const snsLinks = filledLinks.filter((link) => isHttpUrl(link.url));
    const droppedCount = filledLinks.length - snsLinks.length;

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, display_name: displayName, bio, sns_links: snsLinks }, { onConflict: "id" });

    saveBtn.disabled = false;

    if (error) {
      saveHint.textContent = "保存に失敗しました。時間をおいて再度お試しください。";
      saveHint.className = "form-hint error";
      return;
    }
    if (droppedCount > 0) {
      saveHint.textContent = `保存しました。ただしURLの形式が正しくないリンクが${droppedCount}件あったため、それらは保存されませんでした（httpから始まるURLを入力してください）。`;
      saveHint.className = "form-hint warn";
      return;
    }
    saveHint.textContent = "保存しました。";
    saveHint.className = "form-hint";
  });

  return section;
}

function addSnsLinkRow(container, values = { platform: "", url: "" }) {
  const row = document.createElement("div");
  row.className = "sns-link-row";

  const platformInput = document.createElement("input");
  platformInput.type = "text";
  platformInput.className = "sns-platform-input";
  platformInput.placeholder = "X / Instagram など";
  platformInput.maxLength = 30;
  platformInput.value = values.platform ?? "";

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "sns-url-input";
  urlInput.placeholder = "https://...";
  urlInput.maxLength = 300;
  urlInput.value = values.url ?? "";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-icon";
  removeBtn.textContent = "✕";
  removeBtn.setAttribute("aria-label", "このリンクを削除");
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(platformInput);
  row.appendChild(urlInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

// http(s)以外（javascript: など）のURLがリンクとして保存され、
// author.htmlでそのままクリック可能なリンクとして描画されるのを防ぐ。
function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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
  await renderPage(userId);
}
