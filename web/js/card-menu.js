// frank pro — 作品カードの「⋮」メニュー
//
// 「レビューする」（評価とコメントを同時にできる。rate-modal.jsのmode:"both"）
// 「作者のページへ」「通報する」の3項目。
// 以前は「評価する」「コメントを見る」に分かれていたが、評価とコメントを
// 別々にしか操作できないと誤解されやすかったので、プレイ画面の「レビュー」
// ボタンと同じ1本の導線に統一した（rate-modal.jsのmode既定値がそのまま使える）。
// 作者ページへの導線はカード左上の作者名リンク（author-link.js）にもあるが、
// ⋮からも行けるようにしてある（重複していてよい、という運用判断）。
// 一覧（listing.js）・作者ページ（author.js）・履歴（history.js）の
// いずれのカードからも共通で使う。

import { openRateModal } from "./rate-modal.js";
import { openReportModal } from "./report-modal.js";

let openMenuEl = null;

document.addEventListener("click", () => closeOpenMenu());

function closeOpenMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
}

// card: メニューボタンとポップアップの両方を追加する先（position: relative が必要）
// work: { id, title, author_id } を持つオブジェクト（author_idが無ければ「作者のページへ」は出さない）
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

    const reviewBtn = document.createElement("button");
    reviewBtn.type = "button";
    reviewBtn.textContent = "レビューする（評価・コメント）";
    reviewBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeOpenMenu();
      openRateModal(work.id, work.title);
    });
    menu.appendChild(reviewBtn);

    if (work.author_id) {
      const authorBtn = document.createElement("button");
      authorBtn.type = "button";
      authorBtn.textContent = "作者のページへ";
      authorBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeOpenMenu();
        location.href = `author.html?id=${work.author_id}`;
      });
      menu.appendChild(authorBtn);
    }

    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.textContent = "通報する";
    reportBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeOpenMenu();
      openReportModal(work.id, work.title);
    });
    menu.appendChild(reportBtn);

    card.appendChild(menu);
    openMenuEl = menu;
  });

  return btn;
}
