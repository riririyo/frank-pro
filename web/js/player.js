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
import { renderRatingWidget } from "./rating.js";
import { renderComments } from "./comments.js";

let currentWork = null;

export function initPlayer() {
  const overlay = document.getElementById("player-overlay");
  const closeBtn = document.getElementById("player-close");

  closeBtn.addEventListener("click", closePlayer);

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

  renderRatingWidget(document.getElementById("player-rating"), work.id);
  renderComments(document.getElementById("player-comments"), work.id);
}

export function closePlayer({ skipHistory = false } = {}) {
  const overlay = document.getElementById("player-overlay");
  const frameWrap = document.getElementById("player-frame-wrap");

  // ここが要: src="" ではなく要素ごと除去する。裏で動かし続けると端末が熱くなるため
  frameWrap.innerHTML = "";
  overlay.hidden = true;
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
