// frank pro — 作品プレイヤー
//
// 重要な約束事（docs/security-design.md 1-4節）:
//   - iframeは sandbox="allow-scripts allow-pointer-lock" のみ。allow-same-origin は絶対に付けない
//   - 一覧に戻ったら iframe を DOM から破棄する（src="" ではなく要素ごと remove）
//     裏で回り続けると端末が発熱するため
//   - 配信は本体ドメインとは別ドメイン（CONFIG.WORKS_BASE_URL）から行う

import { CONFIG } from "./config.js";
import { getVisitorId, markPlayed } from "./visitor.js";
import { supabase } from "./supabaseClient.js";
import { openRateModal } from "./rate-modal.js";

let currentWork = null;

export function initPlayer() {
  const overlay = document.getElementById("player-overlay");
  const closeBtn = document.getElementById("player-close");
  const rateBtn = document.getElementById("player-rate-btn");

  closeBtn.addEventListener("click", closePlayer);
  rateBtn.addEventListener("click", () => {
    if (!currentWork) return;
    openRateModal(currentWork.id, currentWork.title);
  });

  // ブラウザの戻るボタンでも閉じる（history.pushStateと対にする）
  window.addEventListener("popstate", (e) => {
    if (!overlay.hidden && !(e.state && e.state.workId)) {
      closePlayer({ skipHistory: true });
    } else if (e.state && e.state.workId) {
      openPlayer(e.state.workId, { skipHistory: true });
    }
  });

  // 直接 /?work=xxxxx で開かれた場合に対応
  const params = new URLSearchParams(location.search);
  const initialWorkId = params.get("work");
  if (initialWorkId) {
    openPlayer(initialWorkId, { skipHistory: true });
  }
}

export async function openPlayer(workId, { skipHistory = false } = {}) {
  const overlay = document.getElementById("player-overlay");
  const frameWrap = document.getElementById("player-frame-wrap");
  const titleEl = document.getElementById("player-title");
  const authorLinkEl = document.getElementById("player-author-link");

  const { data: work, error } = await supabase
    .from("works")
    .select("*")
    .eq("id", workId)
    .single();

  if (error || !work) {
    console.error(error);
    alert("作品を読み込めませんでした。");
    return;
  }

  currentWork = work;
  titleEl.textContent = work.title;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";

  // 作者の公開プロフィール（author.html）へのリンク。表示名が未設定でも
  // author.htmlは開けるので、その場合は汎用の文言でリンクだけは出す
  authorLinkEl.hidden = true;
  if (work.author_id) {
    authorLinkEl.href = `author.html?id=${work.author_id}`;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", work.author_id)
      .maybeSingle()
      .then(({ data: profile }) => {
        if (currentWork?.id !== work.id) return; // 読み込み中に別作品に切り替わっていたら反映しない
        authorLinkEl.textContent = profile?.display_name
          ? `by ${profile.display_name}`
          : "作者ページを見る";
        authorLinkEl.hidden = false;
      });
  }

  // iframeはここで初めて生成する。既存があれば先に破棄してから作り直す
  frameWrap.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.src = `${CONFIG.WORKS_BASE_URL}/w/${work.id}.html`;
  iframe.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute(
    "allow",
    "camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'self'"
  );
  iframe.setAttribute("loading", "eager");
  frameWrap.appendChild(iframe);

  if (!skipHistory) {
    history.pushState({ workId: work.id }, "", `?work=${work.id}`);
  }

  markPlayed(work.id);
  recordView(work.id);
}

export function closePlayer({ skipHistory = false } = {}) {
  const overlay = document.getElementById("player-overlay");
  const frameWrap = document.getElementById("player-frame-wrap");
  const authorLinkEl = document.getElementById("player-author-link");

  // ここが要: src="" ではなく要素ごと除去する。裏で動かし続けると端末が熱くなるため
  frameWrap.innerHTML = "";
  overlay.hidden = true;
  authorLinkEl.hidden = true;
  document.body.style.overflow = "";
  currentWork = null;

  if (!skipHistory) {
    history.pushState({}, "", location.pathname);
  }
}

async function recordView(workId) {
  const visitorId = getVisitorId();
  const { error } = await supabase.rpc("record_view", {
    p_work_id: workId,
    p_visitor_id: visitorId,
  });
  if (error) console.error("record_view failed", error);
}
