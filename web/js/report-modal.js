// frank pro — 作品の通報モーダル
//
// カードの「⋮」メニュー（card-menu.js）から開く。thumbnail-crop.jsと同じく、
// 静的HTML側に要素を用意せずJSでオーバーレイを都度生成・破棄する自己完結パターンにしている
// （listing.js・author.js・history.jsのどのページからも同じ見た目で呼べるようにするため）。
//
// 通報の一覧・対応（対応済みにする）は管理画面（admin.js）から行う。
// admin-action Edge Functionは増やさず、reportsテーブル自体のRLS
// （is_adminなら直接select/updateできる。supabase/migrations/0011_reports.sql）
// だけで完結させている。

import { supabase } from "./supabaseClient.js";
import { buildShareButton } from "./share.js";

const REASONS = [
  { value: "spam", label: "スパム・宣伝目的" },
  { value: "inappropriate", label: "不適切な内容（暴力的・性的など）" },
  { value: "copyright", label: "著作権侵害の疑い" },
  { value: "broken", label: "バグ・正常に動作しない" },
  { value: "other", label: "その他" },
];

export function openReportModal(workId, title) {
  const overlay = document.createElement("div");
  overlay.className = "thumb-crop-overlay";
  overlay.innerHTML = `
    <div class="thumb-crop-modal">
      <div class="thumb-crop-header">
        <span>作品を通報</span>
        <div class="thumb-crop-header-actions"></div>
      </div>
      <p class="form-hint">「${escapeHtml(title ?? "")}」を通報します。内容は管理者のみが確認します。</p>
      <div class="report-reason-list"></div>
      <textarea class="report-detail" rows="3" placeholder="詳細があれば入力してください（任意）"></textarea>
      <p class="form-hint report-hint"></p>
      <div class="thumb-crop-actions">
        <button type="button" class="btn" data-action="cancel">キャンセル</button>
        <button type="button" class="btn btn-danger" data-action="submit">通報する</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const headerActionsEl = overlay.querySelector(".thumb-crop-header-actions");
  headerActionsEl.appendChild(buildShareButton(workId, title));
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-icon";
  closeBtn.dataset.action = "cancel";
  closeBtn.setAttribute("aria-label", "閉じる");
  closeBtn.textContent = "✕";
  headerActionsEl.appendChild(closeBtn);

  const reasonListEl = overlay.querySelector(".report-reason-list");
  for (const r of REASONS) {
    const label = document.createElement("label");
    label.className = "report-reason-item";
    label.innerHTML = `<input type="radio" name="report-reason" value="${r.value}" /> ${escapeHtml(r.label)}`;
    reasonListEl.appendChild(label);
  }

  const detailEl = overlay.querySelector(".report-detail");
  const hintEl = overlay.querySelector(".report-hint");
  const submitBtn = overlay.querySelector('[data-action="submit"]');

  function cleanup() {
    overlay.remove();
  }

  overlay.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "cancel") {
      cleanup();
      return;
    }
    if (action === "submit") {
      const reasonInput = overlay.querySelector('input[name="report-reason"]:checked');
      if (!reasonInput) {
        hintEl.textContent = "通報理由を選んでください。";
        hintEl.className = "form-hint report-hint error";
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        hintEl.textContent = "ログインしてから通報してください。";
        hintEl.className = "form-hint report-hint error";
        return;
      }

      submitBtn.disabled = true;
      hintEl.textContent = "送信中…";
      hintEl.className = "form-hint report-hint";

      const { error } = await supabase.from("reports").insert({
        work_id: workId,
        reporter_id: session.user.id,
        reason: reasonInput.value,
        detail: detailEl.value.trim() || null,
      });

      if (error) {
        console.error(error);
        hintEl.textContent = "通報に失敗しました。時間をおいて再度お試しください。";
        hintEl.className = "form-hint report-hint error";
        submitBtn.disabled = false;
        return;
      }

      hintEl.textContent = "通報しました。ご協力ありがとうございます。";
      hintEl.className = "form-hint report-hint";
      submitBtn.disabled = true;
      overlay.querySelector('[data-action="cancel"]').textContent = "閉じる";
      setTimeout(cleanup, 1200);
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
