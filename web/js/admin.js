// frank pro — 管理画面
//
// is_admin = true のアカウントでログインしている場合のみ表示する。
// 実際の変更操作（status変更・ファイル完全削除・BAN）はすべて
// supabase/functions/admin-action 経由（service_role・is_admin再確認あり）で行う。
// クライアント側のこのis_adminチェックは「見せる/見せない」のUXでしかなく、
// 本当の防御はサーバー側（RLS・admin-action内のis_admin確認）にある。
//
// 通報（reports）だけは例外で、admin-action を増やさず reports テーブル自体の
// RLS（is_adminなら直接select/updateできる。supabase/migrations/0011_reports.sql）
// で完結させている。デプロイの手間を増やさないための判断。

import { CONFIG } from "./config.js";
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";

const STATUS_LABELS = { published: "公開中", hidden: "非表示", removed: "削除済み" };
const REPORT_REASON_LABELS = {
  spam: "スパム・宣伝目的",
  inappropriate: "不適切な内容",
  copyright: "著作権侵害の疑い",
  broken: "バグ・正常に動作しない",
  other: "その他",
};

// ①検索・③システム状態チェックは、都度サーバーに問い合わせ直すのではなく、
// 一度読み込んだこれらの配列をその場でフィルタ・集計するだけにしている
// （管理画面はせいぜい数百件規模の想定なので、クライアント側で十分）。
let allWorks = [];
let allProfiles = [];
let allReports = [];

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

  const healthSection = buildSection("システム状態");
  root.appendChild(healthSection.section);

  const worksSection = buildSection("作品");
  const worksSearch = buildSearchInput("タイトル・IDで検索…");
  worksSection.heading.after(worksSearch);
  root.appendChild(worksSection.section);

  const usersSection = buildSection("アカウント");
  const usersSearch = buildSearchInput("名前・IDで検索…");
  usersSection.heading.after(usersSearch);
  root.appendChild(usersSection.section);

  const reportsSection = buildSection("通報（②通報の仕組み）");
  root.appendChild(reportsSection.section);

  worksSearch.addEventListener("input", () => renderWorksList(worksSection.list, worksSearch.value));
  usersSearch.addEventListener("input", () =>
    renderUsersList(usersSection.list, usersSearch.value, worksSection.list)
  );

  await Promise.all([
    loadWorks(worksSection.list),
    loadUsers(usersSection.list, worksSection.list),
    loadReports(reportsSection.list),
  ]);

  // 件数サマリーは他セクションの読み込み結果を使うので、全部読み終えてから組み立てる
  renderHealthCheck(healthSection.list);
}

function buildSection(title) {
  const section = document.createElement("section");
  section.className = "admin-section";
  const heading = document.createElement("h2");
  heading.className = "mypage-section-heading";
  heading.textContent = title;
  section.appendChild(heading);
  const list = document.createElement("div");
  list.className = "admin-list";
  list.textContent = "読み込み中…";
  section.appendChild(list);
  return { section, heading, list };
}

function buildSearchInput(placeholder) {
  const input = document.createElement("input");
  input.type = "search";
  input.className = "admin-search-input";
  input.placeholder = placeholder;
  return input;
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

/* ============ ①検索：作品 ============ */

async function loadWorks(container) {
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

  allWorks = works ?? [];
  renderWorksList(container, "");
}

function renderWorksList(container, query) {
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? allWorks
    : allWorks.filter((w) => w.title.toLowerCase().includes(q) || w.id.toLowerCase().includes(q));

  container.innerHTML = "";
  if (!allWorks.length) {
    container.textContent = "作品がありません。";
    return;
  }
  if (!filtered.length) {
    container.textContent = "該当する作品がありません。";
    return;
  }
  for (const w of filtered) container.appendChild(buildWorkRow(w));
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
        work.status = "published";
        meta.textContent = `${STATUS_LABELS.published} · ${work.id} · 作者: ${work.author_id}`;
      })
    );
  }
  if (work.status !== "hidden") {
    actions.appendChild(
      buildActionBtn("非表示にする", async () => {
        await callAdminAction({ action: "set_work_status", work_id: work.id, status: "hidden" });
        work.status = "hidden";
        meta.textContent = `${STATUS_LABELS.hidden} · ${work.id} · 作者: ${work.author_id}`;
      })
    );
  }
  if (work.status !== "published") {
    // 非表示・削除済み作品の中身を、通報内容の緊急確認のためだけに見られるようにする。
    // 発行されるURLは5分だけ有効（サーバー側で失効）で、CSP sandbox等の隔離ヘッダは
    // 通常配信と同じものが付く。普段使う機能ではないので目立たせすぎない。
    actions.appendChild(
      buildActionBtn("中身を見る（緊急確認用）", async () => {
        const res = await callAdminAction({ action: "get_preview_url", work_id: work.id });
        window.open(res.url, "_blank", "noopener,noreferrer");
      })
    );
  }
  actions.appendChild(
    buildActionBtn(
      "完全に削除する",
      async () => {
        if (!confirm(`「${work.title}」のファイル本体を完全に削除します。元に戻せません。よろしいですか？`)) return;
        await callAdminAction({ action: "delete_work_file", work_id: work.id });
        allWorks = allWorks.filter((w) => w.id !== work.id);
        row.remove();
      },
      "btn-danger"
    )
  );

  row.appendChild(actions);
  return row;
}

/* ============ ①検索：アカウント ============ */

async function loadUsers(container, worksListEl) {
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

  allProfiles = profiles ?? [];
  renderUsersList(container, "", worksListEl);
}

function renderUsersList(container, query, worksListEl) {
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? allProfiles
    : allProfiles.filter(
        (p) => (p.display_name ?? "").toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
      );

  container.innerHTML = "";
  if (!allProfiles.length) {
    container.textContent = "アカウントがありません。";
    return;
  }
  if (!filtered.length) {
    container.textContent = "該当するアカウントがありません。";
    return;
  }
  for (const p of filtered) container.appendChild(buildUserRow(p, worksListEl));
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
        await loadWorks(worksListEl);
      })
    );
  }

  row.appendChild(actions);
  return row;
}

/* ============ ②通報の仕組み ============ */

async function loadReports(container) {
  const { data: reports, error } = await supabase
    .from("reports")
    .select("id, work_id, reason, detail, status, created_at, works(title)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    // reportsテーブルがまだ存在しない（0011のマイグレーション未適用）場合もここに来る
    container.textContent =
      "通報の読み込みに失敗しました（supabase/migrations/0011_reports.sql が未適用の可能性があります）。";
    console.error(error);
    allReports = [];
    return;
  }

  allReports = reports ?? [];
  renderReportsList(container);
}

function renderReportsList(container) {
  container.innerHTML = "";
  const openReports = allReports.filter((r) => r.status === "open");

  if (!allReports.length) {
    container.textContent = "通報はまだありません。";
    return;
  }
  if (!openReports.length) {
    container.textContent = "未対応の通報はありません。";
    return;
  }
  for (const r of openReports) container.appendChild(buildReportRow(r));
}

function buildReportRow(report) {
  const row = document.createElement("div");
  row.className = "admin-row";

  const info = document.createElement("div");
  info.className = "admin-row-info";
  const title = document.createElement("div");
  title.textContent = report.works?.title ?? `(削除済み・不明な作品: ${report.work_id})`;
  const meta = document.createElement("div");
  meta.className = "form-hint";
  const reasonLabel = REPORT_REASON_LABELS[report.reason] ?? report.reason;
  const createdAt = new Date(report.created_at).toLocaleString("ja-JP");
  meta.textContent = `理由: ${reasonLabel} · ${createdAt}${report.detail ? ` · 詳細: ${report.detail}` : ""}`;
  info.appendChild(title);
  info.appendChild(meta);
  row.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "admin-row-actions";

  if (report.work_id) {
    actions.appendChild(
      buildActionBtn("作品を見る", async () => {
        window.open(`index.html?work=${report.work_id}`, "_blank", "noopener,noreferrer");
      })
    );
  }

  actions.appendChild(
    buildActionBtn("対応済みにする", async () => {
      // admin-actionは経由せず、reports_update_admin ポリシー経由で直接更新する
      // （0011_reports.sql）。works同様、is_adminの再確認はサーバー側（RLS）で行われる。
      const { error } = await supabase.from("reports").update({ status: "resolved" }).eq("id", report.id);
      if (error) throw new Error(error.message || "更新に失敗しました");
      report.status = "resolved";
      row.remove();
    })
  );

  row.appendChild(actions);
  return row;
}

/* ============ ③システム状態チェック ============ */

function renderHealthCheck(container) {
  container.innerHTML = "";

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "btn";
  runBtn.textContent = "チェックを実行";

  const resultEl = document.createElement("div");
  resultEl.className = "health-check-result";
  resultEl.textContent = "「チェックを実行」を押すと、配信Worker・管理用APIの状態と件数サマリーを確認できます。";

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    resultEl.textContent = "確認中…";
    const rows = [];

    // 1. 配信Worker（作品HTMLの配信元）にSUPABASE_URL / SUPABASE_SERVICE_ROLE_KEYが
    //    設定されているか。値そのものはWorker側から返らない（boolean のみ）
    try {
      const res = await fetch(`${CONFIG.WORKS_BASE_URL}/health`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        rows.push(buildHealthRow("ok", "配信Worker", "正常"));
      } else if (json) {
        rows.push(
          buildHealthRow(
            "ng",
            "配信Worker",
            `異常（SUPABASE_URL: ${json.supabase_url_set ? "設定済み" : "未設定"} / SUPABASE_SERVICE_ROLE_KEY: ${
              json.service_role_set ? "設定済み" : "未設定"
            }）`
          )
        );
      } else {
        rows.push(buildHealthRow("ng", "配信Worker", `異常（HTTP ${res.status}）`));
      }
    } catch (e) {
      rows.push(buildHealthRow("ng", "配信Worker", "到達できません（URLかネットワークを確認してください）"));
    }

    // 2. 管理操作 Edge Function（admin-action）がデプロイ・到達可能か
    //    OPTIONSは認証不要で応答が返る作りになっているので、これだけで疎通確認になる
    try {
      const res = await fetch(CONFIG.ADMIN_ACTION_URL, { method: "OPTIONS" });
      rows.push(
        res.ok
          ? buildHealthRow("ok", "管理操作API (admin-action)", "正常")
          : buildHealthRow("ng", "管理操作API (admin-action)", `異常（HTTP ${res.status}）`)
      );
    } catch (e) {
      rows.push(buildHealthRow("ng", "管理操作API (admin-action)", "到達できません（未デプロイの可能性があります）"));
    }

    // 3. 件数サマリー（このページ読み込み時に取得済みのデータを集計するだけ。追加の問い合わせはしない）
    const publishedCount = allWorks.filter((w) => w.status === "published").length;
    const hiddenCount = allWorks.filter((w) => w.status === "hidden").length;
    const removedCount = allWorks.filter((w) => w.status === "removed").length;
    const bannedCount = allProfiles.filter((p) => p.is_banned).length;
    const openReportCount = allReports.filter((r) => r.status === "open").length;

    rows.push(
      buildHealthRow(
        "info",
        "作品数",
        `公開中 ${publishedCount} ・ 非表示 ${hiddenCount} ・ 削除済み ${removedCount}`
      )
    );
    rows.push(buildHealthRow("info", "アカウント数", `${allProfiles.length}件（BAN中 ${bannedCount}件）`));
    rows.push(buildHealthRow("info", "未対応の通報", `${openReportCount}件`));

    resultEl.innerHTML = "";
    for (const row of rows) resultEl.appendChild(row);
    runBtn.disabled = false;
  });

  container.appendChild(runBtn);
  container.appendChild(resultEl);
}

function buildHealthRow(level, label, value) {
  const row = document.createElement("div");
  row.className = `health-check-row health-check-${level}`;
  const badge = document.createElement("span");
  badge.className = "health-check-badge";
  badge.textContent = level === "ok" ? "OK" : level === "ng" ? "NG" : "・";
  row.appendChild(badge);
  const text = document.createElement("span");
  text.textContent = `${label}: ${value}`;
  row.appendChild(text);
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
