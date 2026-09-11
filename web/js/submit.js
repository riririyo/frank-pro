// frank pro — 投稿フロー
//
// posting-guideline-draft.md の技術要件をこの画面で機械的にチェックする。
// ただし「コードを読む検査は合否基準にしない」（同ガイドライン3章）。
// 検出はあくまで警告で、実際の遮断は配信環境側（Worker + CSP）で行う。

import { CONFIG } from "./config.js";
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";

const MAX_SIZE = CONFIG.MAX_FILE_SIZE_BYTES;

let selectedFile = null;
let hasPreviewedOnce = false;
let previewUrl = null;

export async function initSubmitPage() {
  const user = await requireAuth();
  if (!user) return;

  const fileInput = document.getElementById("file-input");
  const previewFrame = document.getElementById("mobile-preview-frame");
  const warningsEl = document.getElementById("upload-warnings");
  const submitBtn = document.getElementById("submit-btn");
  const previewHint = document.getElementById("preview-hint");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await handleFileSelected(file, { previewFrame, warningsEl, previewHint });
  });

  previewFrame.addEventListener("load", () => {
    if (!previewUrl) return; // 初期about:blankでは発火させない
    hasPreviewedOnce = true;
    previewHint.textContent = "確認できました。下のチェック項目を確認して投稿してください。";
    previewHint.classList.remove("warn");
  });

  document.getElementById("submit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleSubmit({ submitBtn });
  });
}

async function handleFileSelected(file, { previewFrame, warningsEl, previewHint }) {
  warningsEl.innerHTML = "";
  hasPreviewedOnce = false;

  if (!file.name.toLowerCase().endsWith(".html")) {
    warningsEl.innerHTML = "<p class='form-hint error'>HTMLファイルを選んでください。</p>";
    selectedFile = null;
    return;
  }
  if (file.size > MAX_SIZE) {
    warningsEl.innerHTML = `<p class='form-hint error'>ファイルサイズが上限（5MB）を超えています（${(file.size / 1024 / 1024).toFixed(2)}MB）。</p>`;
    selectedFile = null;
    return;
  }

  selectedFile = file;

  const text = await file.text();
  renderStaticWarnings(text, warningsEl);

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  // ここでもallow-same-originは付けない。本番配信と同じ隔離条件で確認してもらうため
  previewFrame.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
  previewFrame.src = previewUrl;

  previewHint.textContent = "プレビューを確認してから投稿してください（未確認だと投稿できません）。";
  previewHint.classList.add("warn");
}

function renderStaticWarnings(sourceText, warningsEl) {
  const warnings = [];

  // これは合否判定ではなく気づいてもらうための警告（posting-guideline-draft.md 3章）
  if (/localStorage|sessionStorage|document\.cookie/.test(sourceText)) {
    warnings.push(
      "localStorage / sessionStorage / Cookie の使用が検出されました。配信環境ではこれらに触れずSecurityErrorで停止します。try-catchで囲むか、使わない設計にしてください。"
    );
  }
  if (/fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(sourceText)) {
    warnings.push(
      "外部通信を行うコードが検出されました。配信環境では通信がブロックされ動作しません。"
    );
  }
  if (/<(img|script|link|audio|video)\s+[^>]*(src|href)=["']https?:\/\//i.test(sourceText)) {
    warnings.push(
      "外部URLを参照するタグが検出されました。画像・音源等はdata URIで埋め込んでください。"
    );
  }

  if (warnings.length === 0) {
    warningsEl.innerHTML = "<p class='form-hint'>自動チェックでは問題は見つかりませんでした。</p>";
    return;
  }
  warningsEl.innerHTML = warnings
    .map((w) => `<p class="form-hint warn">⚠️ ${escapeHtml(w)}</p>`)
    .join("");
}

async function handleSubmit({ submitBtn }) {
  const title = document.getElementById("title-input").value.trim();
  const description = document.getElementById("description-input").value.trim();
  const checklistBoxes = [...document.querySelectorAll(".checklist input[type=checkbox]")];

  if (!selectedFile) {
    alert("HTMLファイルを選択してください。");
    return;
  }
  if (!title) {
    alert("タイトルを入力してください。");
    return;
  }
  if (!hasPreviewedOnce) {
    alert("投稿前に、縦長プレビューで一度動作を確認してください。");
    return;
  }
  if (checklistBoxes.some((b) => !b.checked)) {
    alert("チェックリストの全項目にチェックを入れてください。");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "投稿中…";

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("ログインが切れています。再度ログインしてください。");

    const signRes = await fetch(CONFIG.SIGN_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        title,
        description,
        file_size_bytes: selectedFile.size,
      }),
    });
    const signJson = await signRes.json();
    if (!signRes.ok) throw new Error(signJson.error || "アップロード準備に失敗しました");

    const putRes = await fetch(signJson.upload_url, {
      method: "PUT",
      headers: { "Content-Type": signJson.content_type },
      body: selectedFile,
    });
    if (!putRes.ok) throw new Error("ファイルのアップロードに失敗しました");

    location.href = `index.html?work=${signJson.work_id}`;
  } catch (e) {
    alert(e.message || "投稿に失敗しました");
    submitBtn.disabled = false;
    submitBtn.textContent = "投稿する";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
