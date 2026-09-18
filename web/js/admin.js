// frank pro — 管理画面
//
// is_admin = true のアカウントでログインしている場合のみ表示する。
// 実際の変更操作（status変更・ファイル完全削除・BAN）はすべて
// supabase/functions/admin-action 経由（service_role・is_admin再確認あり）で行う。
// クライアント側のこのis_adminチェックは「見せる/見せない」のUXでしかなく、
// 本当の防御はサーバー側（RLS・admin-action内のis_admin確認）にある。

import { CONFIG } from "./config.js";
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";

const STATUS_LABELS = { published: "公開中", hidden: "非表示", removed: "削除済み" };

export async function initAdminPage() {
  const root = document.getElementById("admin-root");
  const user = await requireAuth();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    root.innerHTML = "<h1>管理画面</h1><p class='form-hint error'>このページを見る権限がありません。</p>";
    return;
  }

  root.innerHTML = "<h1>管理画面</h1>";

  const worksSection = document.createElement("section");
  worksSection.className = "admin-section";
  const worksHeading = document.createElement("h2");
  worksHeading.className = "mypage-section-heading";
  worksHeading.textContent = "作品";
  worksSection.appendChild(worksHeading);
  const worksList = document.createElement("div");
  worksList.className = "admin-list";
  worksList.textContent = "読み込み中…";
  worksSection.appendChild(worksList);
  root.appendChild(worksSection);

  const usersSection = document.createElement("section");
  usersSection.className = "admin-section";
  const usersHeading = document.createElement("h2");
  usersHeading.className = "mypage-section-heading";
  usersHeading.textContent = "アカウント";
  usersSection.appendChild(usersHeading);
  const usersList = document.createElement("div");
  usersList.className = "admin-list";
  usersList.textContent = "読み込み中…";
  usersSection.appendChild(usersList);
  root.appendChild(usersSection);

  await Promise.all([renderWorks(worksList), renderUsers(usersList, worksList)]);
}

async function callAdminAction(payload) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("ログインが切れています。再度ログインしてください。");

  const res = await fetch(CONFIG.ADMIN_ACTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "操作に失敗しました");
  return json;
}

async function renderWorks(container) {
  const { data: works, error } = await supabase
    .from("works")
    .select("id, title, author_id, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    container.textContent = "作品の読み込みに失敗しました。";
    console.error(error);
    return;
  }

  container.innerHTML = "";
  if (!works.length) {
    container.textContent = "作品がありません。";
    return;
  }

  for (const w of works) {
    container.appendChild(buildWorkRow(w));
  }
}

function buildWorkRow(work) {
  const row = document.createElement("div");
  row.className = "admin-row";

  const info = document.createElement("div");
  info.className = "admin-row-info";
  const title = document.createElement("div");
  title.textContent = work.title;
  const meta = document.createElement("div");
  meta.className = "form-hint";
  meta.textContent = `${STATUS_LABELS[work.status] ?? work.status} · ${work.id} · 作者: ${work.author_id}`;
  info.appendChild(title);
  info.appendChild(meta);
  row.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "admin-row-actions";

  if (work.status !== "published") {
    actions.appendChild(
      buildActionBtn("復元する", async () => {
        await callAdminAction({ action: "set_work_status", work_id: work.id, status: "published" });
        row.querySelector(".form-hint").textContent = meta.textContent.replace(/^[^·]+/, `${STATUS_LABELS.published} `);
      })
    );
  }
  if (work.status !== "hidden") {
    actions.appendChild(
      buildActionBtn("非表示にする", async () => {
        await callAdminAction({ action: "set_work_status", work_id: work.id, status: "hidden" });
        meta.textContent = meta.textContent.replace(/^[^·]+/, `${STATUS_LABELS.hidden} `);
      })
    );
  }
  actions.appendChild(
    buildActionBtn(
      "完全に削除する",
      async () => {
        if (!confirm(`「${work.title}」のファイル本体を完全に削除します。元に戻せません。よろしいですか？`)) return;
        await callAdminAction({ action: "delete_work_file", work_id: work.id });
        row.remove();
      },
      "btn-danger"
    )
  );

  row.appendChild(actions);
  return row;
}

async function renderUsers(container, worksListEl) {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, display_name, is_admin, is_banned")
    .order("display_name", { ascending: true })
    .limit(200);

  if (error) {
    container.textContent = "アカウントの読み込みに失敗しました。";
    console.error(error);
    return;
  }

  container.innerHTML = "";
  if (!profiles.length) {
    container.textContent = "アカウントがありません。";
    return;
  }

  for (const p of profiles) {
    container.appendChild(buildUserRow(p, worksListEl));
  }
}

function buildUserRow(profile, worksListEl) {
  const row = document.createElement("div");
  row.className = "admin-row";

  const info = document.createElement("div");
  info.className = "admin-row-info";
  const name = document.createElement("div");
  name.textContent = profile.display_name + (profile.is_admin ? "（管理者）" : "");
  const meta = document.createElement("div");
  meta.className = "form-hint";
  meta.textContent = `${profile.is_banned ? "BAN中" : "通常"} · ${profile.id}`;
  info.appendChild(name);
  info.appendChild(meta);
  row.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "admin-row-actions";

  if (!profile.is_admin) {
    actions.appendChild(
      buildActionBtn(
        profile.is_banned ? "BAN解除" : "BANする",
        async () => {
          const nextBanned = !profile.is_banned;
          if (nextBanned && !confirm(`${profile.display_name} をBANします。よろしいですか？`)) return;
          await callAdminAction({ action: "set_user_ban", user_id: profile.id, banned: nextBanned });
          profile.is_banned = nextBanned;
          meta.textContent = `${nextBanned ? "BAN中" : "通常"} · ${profile.id}`;
        },
        profile.is_banned ? "" : "btn-danger"
      )
    );
    actions.appendChild(
      buildActionBtn("全作品を非表示にする", async () => {
        if (!confirm(`${profile.display_name} の公開中の作品をすべて非表示にします。よろしいですか？`)) return;
        await callAdminAction({ action: "hide_all_user_works", user_id: profile.id });
        await renderWorks(worksListEl);
      })
    );
  }

  row.appendChild(actions);
  return row;
}

function buildActionBtn(label, onClick, extraClass = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn ${extraClass}`.trim();
  btn.textContent = label;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await onClick();
    } catch (e) {
      alert(e.message || "操作に失敗しました");
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}
