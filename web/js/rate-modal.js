// frank pro — 評価・コメントモーダル
//
// プレイ画面（player.js）とは独立している。
// 一覧カードの「⋮」メニュー →「評価する」から開く（listing.js / author.js）。
// プレイ中の画面を圧迫しないよう、評価・コメントはここに切り出した。

import { renderRatingWidget } from "./rating.js";
import { renderComments } from "./comments.js";

export function initRateModal() {
  const overlay = document.getElementById("rate-modal-overlay");
  const closeBtn = document.getElementById("rate-modal-close");
  if (!overlay || !closeBtn) return;

  closeBtn.addEventListener("click", closeRateModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeRateModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeRateModal();
  });
}

// focus: "rating"（デフォルト）か "comments"。
// プレイ画面に「評価」「コメント」の2ボタンを置いたので、押した方の内容が
// 開いた瞬間に見えるよう、該当セクションまでスクロールする
export function openRateModal(workId, title, focus = "rating") {
  const overlay = document.getElementById("rate-modal-overlay");
  if (!overlay) return;

  document.getElementById("rate-modal-title").textContent = title ?? "";
  overlay.hidden = false;
  document.body.style.overflow = "hidden";

  const commentsEl = document.getElementById("rate-modal-comments");
  renderRatingWidget(document.getElementById("rate-modal-rating"), workId);
  renderComments(commentsEl, workId);

  if (focus === "comments") {
    // 中身の描画が終わってから。setTimeout(0)で描画後の次フレームまで遅らせる
    setTimeout(() => commentsEl.scrollIntoView({ block: "start" }), 0);
  }
}

export function closeRateModal() {
  const overlay = document.getElementById("rate-modal-overlay");
  if (!overlay) return;

  overlay.hidden = true;
  document.body.style.overflow = "";
  document.getElementById("rate-modal-rating").innerHTML = "";
  document.getElementById("rate-modal-comments").innerHTML = "";
}
