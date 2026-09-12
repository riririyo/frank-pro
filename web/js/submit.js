// frank pro — 投稿フロー
//
// posting-guideline-draft.md の技術要件をこの画面で機械的にチェックする。
// ただし「コードを読む検査は合否基準にしない」（同ガイドライン3章）。
// 検出はあくまで警告で、実際の遮断は配信環境側（Worker + CSP）で行う。

import { CONFIG } from "./config.js";
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";

const MAX_SIZE = CONFIG.MAX_FILE_SIZE_BYTES;
const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024; // 2MB（0004_storage.sqlのthumbnailsバケット上限と一致させる）
const THUMBNAIL_MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

let selectedFile = null;
let selectedThumbnailFile = null;
let hasPreviewedOnce = false;
let previewUrl = null;
let thumbnailPreviewUrl = null;

export async function initSubmitPage() {
  const user = await requireAuth();
  if (!user) return;

  const fileInput = document.getElementById("file-input");
  const previewFrame = document.getElementById("mobile-preview-frame");
  const warningsEl = document.getElementById("upload-warnings");
  const submitBtn = document.getElementById("submit-btn");
  const previewHint = document.getElementById("preview-hint");
  const thumbnailInput = document.getElementById("thumbnail-input");
  const thumbnailPreviewEl = document.getElementById("thumbnail-preview");
  const thumbnailHint = document.getElementById("thumbnail-hint");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await handleFileSelected(file, { previewFrame, warningsEl, previewHint });
  });

  thumbnailInput.addEventListener("change", () => {
    handleThumbnailSelected(thumbnailInput.files[0], { thumbnailPreviewEl, thumbnailHint });
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

function handleThumbnailSelected(file, { thumbnailPreviewEl, thumbnailHint }) {
  thumbnailPreviewEl.innerHTML = "";
  selectedThumbnailFile = null;

  if (!file) return;

  if (!THUMBNAIL_MIME_TO_EXT[file.type]) {
    thumbnailHint.textContent = "PNG・JPEG・WebPのいずれかを選んでください。";
    thumbnailHint.className = "form-hint error";
    return;
  }
  if (file.size > MAX_THUMBNAIL_SIZE) {
    thumbnailHint.textContent = `ファイルサイズが上限（2MB）を超えています（${(file.size / 1024 / 1024).toFixed(2)}MB）。`;
    thumbnailHint.className = "form-hint error";
    return;
  }

  selectedThumbnailFile = file;
  thumbnailHint.textContent = "この画像がサムネイルとして使われます。";
  thumbnailHint.className = "form-hint";

  if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
  thumbnailPreviewUrl = URL.createObjectURL(file);
  const img = document.createElement("img");
  img.src = thumbnailPreviewUrl;
  img.style.width = "96px";
  img.style.height = "128px";
  img.style.objectFit = "cover";
  img.style.borderRadius = "10px";
  img.style.marginTop = "8px";
  thumbnailPreviewEl.appendChild(img);
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

    const { error: uploadError } = await supabase.storage
      .from(signJson.bucket)
      .uploadToSignedUrl(signJson.path, signJson.token, selectedFile, {
        contentType: signJson.content_type,
      });
    if (uploadError) throw new Error("ファイルのアップロードに失敗しました");

    // サムネイルは任意項目なので、失敗しても投稿自体は成功扱いにする
    // （未設定のままなら日次バッチが後で自動生成する。0004_storage.sql / 0001_init.sqlのthumbnail_source参照）
    if (selectedThumbnailFile) {
      await uploadThumbnail(signJson.work_id, session.user.id, selectedThumbnailFile);
    }

    location.href = `index.html?work=${signJson.work_id}`;
  } catch (e) {
    alert(e.message || "投稿に失敗しました");
    submitBtn.disabled = false;
    submitBtn.textContent = "投稿する";
  }
}

async function uploadThumbnail(workId, userId, file) {
  try {
    const ext = THUMBNAIL_MIME_TO_EXT[file.type];
    // thumbnails_insert_own_path ポリシー（0004_storage.sql）が
    // 先頭セグメント=自分のuidのパスにしかアップロードを許可しないため、この形にする
    const path = `${userId}/${workId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("thumbnails")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from("thumbnails").getPublicUrl(path);

    const { error: updateError } = await supabase
      .from("works")
      .update({ thumbnail_path: publicUrlData.publicUrl, thumbnail_source: "author" })
      .eq("id", workId);
    if (updateError) throw updateError;
  } catch (e) {
    // 投稿自体は成功しているので、ここで失敗してもブロックしない。
    // thumbnail_sourceは'pending'のままなので、日次バッチが後で自動生成してくれる。
    console.error("thumbnail upload failed", e);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
