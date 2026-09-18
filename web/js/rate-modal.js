// frank pro — レビュー（評価・コメント）モーダル
//
// プレイ画面（player.js）とは独立している。
// プレイ画面の「レビュー」ボタン、一覧カードの「⋮」メニュー →「レビューする」
// （listing.js / author.js / card-menu.js）の両方から同じモーダルを開く。
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

export function openRateModal(workId, title) {
  const overlay = document.getElementById("rate-modal-overlay");
  if (!overlay) return;

  document.getElementById("rate-modal-title").textContent = title ?? "";
  overlay.hidden = false;
  document.body.style.overflow = "hidden";

  renderRatingWidget(document.getElementById("rate-modal-rating"), workId);
  renderComments(document.getElementById("rate-modal-comments"), workId);
}

export function closeRateModal() {
  const overlay = document.getElementById("rate-modal-overlay");
  if (!overlay) return;

  overlay.hidden = true;
  document.body.style.overflow = "";
  document.getElementById("rate-modal-rating").innerHTML = "";
  document.getElementById("rate-modal-comments").innerHTML = "";
}
