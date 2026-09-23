// frank pro — 投稿フロー
//
// posting-guideline-draft.md の技術要件をこの画面で機械的にチェックする。
// ただし「コードを読む検査は合否基準にしない」（同ガイドライン3章）。
// 検出はあくまで警告で、実際の遮断は配信環境側（Worker + CSP）で行う。

import { CONFIG } from "./config.js";
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import {
  THUMBNAIL_MIME_TO_EXT,
  MAX_THUMBNAIL_SIZE,
  MAX_THUMBNAIL_RAW_SIZE,
  compressThumbnailImage,
  uploadThumbnail as uploadThumbnailShared,
} from "./thumbnail.js";
import { cropThumbnailImage } from "./thumbnail-crop.js";
import { GENRES } from "./genres.js";

const MAX_SIZE = CONFIG.MAX_FILE_SIZE_BYTES;

// 音声有無(has_sound)は投稿者に自己申告させず、選択したHTML本文から自動判定する
// （sign-upload Edge Functionはアップロードされる実ファイルを受け取らないため、
// ここで判定してsign-upload呼び出し時にbooleanだけを送る）。
const SOUND_PATTERNS = [/<audio[\s>]/i, /AudioContext/, /webkitAudioContext/, /new\s+Audio\s*\(/];

const AI_MERGE_PROMPT = `あなたが今書いたコード（HTML/CSS/JS）を、単一のHTMLファイル1つにまとめてください。
- CSSは<style>タグに、JavaScriptは<script>タグに直接埋め込んでください（外部ファイルの<link>/<script src>は使わない）。
- 画像・フォント・音声などのバイナリ素材は data URI としてインライン化してください。
- localStorage / sessionStorage / Cookie を使っている場合は、必ず try-catch で囲んでください（使えない環境でもエラーで停止しないように）。
- 外部URLへの fetch / XMLHttpRequest / WebSocket 通信は行わないでください（配信環境でブロックされ動作しません）。
- 完成したら、1つの .html ファイルとして出力してください。`;

let selectedFile = null;
let selectedThumbnailFile = null;
let hasPreviewedOnce = false;
let previewUrl = null;
let thumbnailPreviewUrl = null;
let detectedHasSound = false;

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
  const pasteDetails = document.querySelector(".paste-html");
  const pasteTextarea = document.getElementById("html-paste-input");
  const pasteApplyBtn = document.getElementById("html-paste-apply-btn");
  const pasteHint = document.getElementById("html-paste-hint");
  const previewModeTabs = document.getElementById("preview-mode-tabs");
  const mobilePreview = document.getElementById("mobile-preview");

  renderGenreOptions();
  initAiMergePrompt();

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await handleFileSelected(file, { previewFrame, warningsEl, previewHint });
  });

  // ファイル選択の代わりに、HTMLコードを直接貼り付けても投稿できるようにする。
  // 貼り付けた全文を画面に表示し続ける必要はないので、適用後はパネルを閉じる
  pasteApplyBtn.addEventListener("click", async () => {
    const code = pasteTextarea.value;
    if (!code.trim()) {
      pasteHint.textContent = "コードを貼り付けてください。";
      pasteHint.className = "form-hint error";
      return;
    }
    const file = new File([code], "pasted-work.html", { type: "text/html" });
    fileInput.value = "";
    await handleFileSelected(file, { previewFrame, warningsEl, previewHint });
    if (selectedFile) {
      pasteHint.textContent = `貼り付けたコード（${code.length}文字）を使用します。`;
      pasteHint.className = "form-hint";
      if (pasteDetails) pasteDetails.open = false;
    }
  });

  if (previewModeTabs && mobilePreview) {
    previewModeTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".preview-mode-tab");
      if (!btn) return;
      previewModeTabs
        .querySelectorAll(".preview-mode-tab")
        .forEach((el) => el.setAttribute("aria-selected", el === btn ? "true" : "false"));
      mobilePreview.classList.toggle("is-landscape", btn.dataset.mode === "landscape");
    });
  }

  thumbnailInput.addEventListener("change", async () => {
    const file = thumbnailInput.files[0];
    thumbnailInput.value = "";
    if (!file) return;
    await handleThumbnailSelected(file, { thumbnailPreviewEl, thumbnailHint });
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

function renderGenreOptions() {
  const genreEl = document.getElementById("genre-select");
  if (!genreEl) return;

  GENRES.forEach((genre, i) => {
    const label = document.createElement("label");
    label.className = "genre-option";
    const checked = i === 0 ? " checked" : "";
    label.innerHTML = `<input type="radio" name="genre" value="${genre.value}"${checked} /> ${escapeHtml(genre.label)}`;
    genreEl.appendChild(label);
  });
}

function initAiMergePrompt() {
  const textarea = document.getElementById("ai-merge-prompt-text");
  const copyBtn = document.getElementById("ai-merge-prompt-copy-btn");
  const hint = document.getElementById("ai-merge-prompt-hint");
  if (!textarea || !copyBtn) return;

  textarea.value = AI_MERGE_PROMPT;

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(AI_MERGE_PROMPT);
      const original = copyBtn.textContent;
      copyBtn.textContent = "コピーしました";
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 1500);
    } catch {
      textarea.select();
      if (hint) hint.textContent = "コピーできなかったので、テキストエリアを選択しました。手動でコピーしてください。";
    }
  });
}

async function handleFileSelected(file, { previewFrame, warningsEl, previewHint }) {
  warningsEl.innerHTML = "";
  hasPreviewedOnce = false;
  detectedHasSound = false;

  if (!file.name.toLowerCase().endsWith(".html")) {
    warningsEl.innerHTML = "<p class='form-hint error'>HTMLファイルを選んでください。</p>";
    selectedFile = null;
    return;
  }
  if (file.size > MAX_SIZE) {
    warningsEl.innerHTML = `<p class='form-hint error'>ファイルサイズが上限（10MB）を超えています（${(file.size / 1024 / 1024).toFixed(2)}MB）。</p>`;
    selectedFile = null;
    return;
  }

  selectedFile = file;

  const text = await file.text();
  detectedHasSound = SOUND_PATTERNS.some((re) => re.test(text));
  renderStaticWarnings(text, warningsEl);

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  // ここでもallow-same-originは付けない。本番配信と同じ隔離条件で確認してもらうため
  previewFrame.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
  previewFrame.src = previewUrl;

  previewHint.textContent = "プレビューを確認してから投稿してください（未確認だと投稿できません）。";
  previewHint.classList.add("warn");
}

async function handleThumbnailSelected(file, { thumbnailPreviewEl, thumbnailHint }) {
  thumbnailPreviewEl.innerHTML = "";
  selectedThumbnailFile = null;

  if (!file) return;

  if (!THUMBNAIL_MIME_TO_EXT[file.type]) {
    thumbnailHint.textContent = "PNG・JPEG・WebPのいずれかを選んでください。";
    thumbnailHint.className = "form-hint error";
    return;
  }
  if (file.size > MAX_THUMBNAIL_RAW_SIZE) {
    thumbnailHint.textContent = `ファイルサイズが大きすぎます（${(file.size / 1024 / 1024).toFixed(2)}MB）。別の画像を選んでください。`;
    thumbnailHint.className = "form-hint error";
    return;
  }

  const cropped = await cropThumbnailImage(file);
  if (!cropped) return; // ユーザーがキャンセル

  const originalSize = cropped.size;
  thumbnailHint.textContent = "画像を圧縮しています…";
  thumbnailHint.className = "form-hint";

  const compressed = await compressThumbnailImage(cropped);

  if (compressed.size > MAX_THUMBNAIL_SIZE) {
    thumbnailHint.textContent = `圧縮しても上限（2MB）を超えています（${(compressed.size / 1024 / 1024).toFixed(2)}MB）。別の画像を選んでください。`;
    thumbnailHint.className = "form-hint error";
    return;
  }

  selectedThumbnailFile = compressed;

  const savedPercent =
    originalSize > 0 ? Math.round((1 - compressed.size / originalSize) * 100) : 0;
  thumbnailHint.textContent =
    savedPercent > 0
      ? `この画像がサムネイルとして使われます（${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressed.size / 1024 / 1024).toFixed(2)}MBに自動圧縮）`
      : "この画像がサムネイルとして使われます。";
  thumbnailHint.className = "form-hint";

  if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
  thumbnailPreviewUrl = URL.createObjectURL(compressed);
  const img = document.createElement("img");
  img.src = thumbnailPreviewUrl;
  img.style.width = "160px";
  img.style.height = "120px";
  img.style.objectFit = "cover";
  img.style.borderRadius = "10px";
  img.style.marginTop = "8px";
  thumbnailPreviewEl.appendChild(img);
}

function renderStaticWarnings(sourceText, warningsEl) {
  const warnings = [];

  // これは合否判定ではなく気づいてもらうための注意（posting-guideline-draft.md 3章）。
  // try-catchで対策済みなら投稿をブロックしないので、その旨を明記して不安にさせないようにする
  // （改善点メモ2026-09-23 項目0：文字列を見つけただけで警告が出て、対策済みの投稿者も不安になっていたため）。
  if (/localStorage|sessionStorage|document\.cookie/.test(sourceText)) {
    warnings.push(
      "localStorage / sessionStorage / Cookie の使用が検出されました。try-catchで囲まれていれば投稿・動作に問題はありません。ただし配信環境ではこれらの機能自体は使えないため、セーブデータやベスト記録などは保存されません（毎回リセットされます）。"
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
  const genreInput = document.querySelector('input[name="genre"]:checked');
  const category = genreInput ? genreInput.value : "other";
  const mobileOkInput = document.getElementById("mobile-ok-input");
  const mobileOk = mobileOkInput ? mobileOkInput.checked : true;
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
        category,
        mobile_ok: mobileOk,
        has_sound: detectedHasSound,
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
    if (uploadError) {
      // sign-uploadの時点でworks行はもう作られている（status: 'published'）。
      // ここで失敗した場合、掃除しないとファイルの実体が無い「壊れた投稿」が
      // 一覧に残り続けてしまうので、作成済みの行を削除しておく
      // （works_delete_ownポリシーにより本人の行は削除できる）。
      await supabase.from("works").delete().eq("id", signJson.work_id);
      throw new Error("ファイルのアップロードに失敗しました");
    }

    // サムネイルは任意項目なので、失敗しても投稿自体は成功扱いにする
    // （未設定のままなら自動生成される。0004_storage.sql / 0001_init.sqlのthumbnail_source参照）
    if (selectedThumbnailFile) {
      await uploadThumbnail(signJson.work_id, session.user.id, selectedThumbnailFile);
    } else {
      // 自分でサムネイルを設定しなかった場合、自動生成バッチをその場で起動する
      // （設定しない限り最大24時間待つ、ではなく数分以内に反映されるようにする）
      await triggerThumbnailBatch(signJson.work_id, session.access_token);
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
    await uploadThumbnailShared(supabase, workId, userId, file);
  } catch (e) {
    // 投稿自体は成功しているので、ここで失敗してもブロックしない。
    // thumbnail_sourceは'pending'のままなので、自動生成バッチが後で拾ってくれる。
    console.error("thumbnail upload failed", e);
  }
}

// サムネイル自動生成バッチ（GitHub Actions）をその場で起動する。
// 失敗しても投稿自体はすでに成功しているので何もしない（最悪、次の定期実行で拾われる）。
async function triggerThumbnailBatch(workId, accessToken) {
  try {
    await fetch(CONFIG.TRIGGER_THUMBNAIL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ work_id: workId }),
    });
  } catch (e) {
    console.error("thumbnail batch trigger failed", e);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
