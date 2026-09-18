// frank pro — 作品カードの「⋮」メニュー
//
// 「評価する」「コメントを見る」「作者のページへ」の3項目。
// 以前は「レビューする」（評価+コメントが同じモーダル）1本だったが、
// 評価だけ・コメントだけを見たい場合にも対応できるよう分割した。
// 作者ページへの導線はカード左上の作者名リンク（author-link.js）にもあるが、
// ⋮からも行けるようにしてもる（重複していてよい、という運用判断）。
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

    const rateBtn = document.createElement("button");
    rateBtn.type = "button";
    rateBtn.textContent = "評価する";
    rateBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeOpenMenu();
      openRateModal(work.id, work.title, { mode: "rating" });
    });
    menu.appendChild(rateBtn);

    const commentBtn = document.createElement("button");
    commentBtn.type = "button";
    commentBtn.textContent = "コメントを見る";
    commentBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeOpenMenu();
      openRateModal(work.id, work.title, { mode: "comments" });
    });
    menu.appendChild(commentBtn);

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
