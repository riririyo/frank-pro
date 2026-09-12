// frank pro — 作品カードの「⋮」メニュー
//
// 評価・コメントは常時表示だとプレイ画面を圧迫するので、
// 一覧・作者ページのカードから「⋮」→「評価する」で開く方式にした（rate-modal.js）。
// 一覧ページ（listing.js）・作者ページ（author.js）の両方から共通で使う。

import { openRateModal } from "./rate-modal.js";

let openMenuEl = null;

document.addEventListener("click", () => closeOpenMenu());

function closeOpenMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
}

// card: メニューボタンとポップアップの両方を追加する先（position: relative が必要）
// work: { id, title } を持つオブジェクト
export function buildCardMenuButton(card, work) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "card-menu-btn";
  btn.textContent = "⋮";
  btn.setAttribute("aria-label", "メニュー");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();

    const alreadyOpenForThis = openMenuEl && openMenuEl.dataset.workId === String(work.id);
    closeOpenMenu();
    if (alreadyOpenForThis) return;

    const menu = document.createElement("div");
    menu.className = "card-menu";
    menu.dataset.workId = String(work.id);
    menu.addEventListener("click", (ev) => ev.stopPropagation());

    const rateBtn = document.createElement("button");
    rateBtn.type = "button";
    rateBtn.textContent = "評価する";
    rateBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeOpenMenu();
      openRateModal(work.id, work.title);
    });
    menu.appendChild(rateBtn);

    card.appendChild(menu);
    openMenuEl = menu;
  });

  return btn;
}
