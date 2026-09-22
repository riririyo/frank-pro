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
  const reviewBtn = document.getElementById("player-review-btn");
  const rotateBtn = document.getElementById("player-rotate-btn");
  const landscapeBtn = document.getElementById("player-landscape-btn");
  const fullscreenBtn = document.getElementById("player-fullscreen-btn");

  closeBtn.addEventListener("click", closePlayer);

  // PCでスマホ向けゲームを遊ぶと横に間延びして見えるので、縦長の枠に収めるモード。
  // 作品側のHTML/CSSはそのまま、表示する箱の形だけ変えている。
  // 枠の左右に生まれる余白には、作者プロフィールとおすすめ作品を表示する
  if (rotateBtn) {
    rotateBtn.addEventListener("click", () => {
      overlay.classList.remove("force-landscape");
      landscapeBtn?.classList.remove("active");
      const active = overlay.classList.toggle("force-portrait");
      rotateBtn.classList.toggle("active", active);
      updateFramedSize();
      updateSidePanels();
    });
  }

  // PC画面モード: 縦画面モードと同じ考え方で、今度は16:9のPC画面枠に収める
  // （逆にPCでウィンドウが横長すぎて上部バーだけ間延びして見える、という指摘への対応）
  if (landscapeBtn) {
    landscapeBtn.addEventListener("click", () => {
      overlay.classList.remove("force-portrait");
      rotateBtn?.classList.remove("active");
      const active = overlay.classList.toggle("force-landscape");
      landscapeBtn.classList.toggle("active", active);
      updateFramedSize();
      updateSidePanels();
    });
  }

  window.addEventListener("resize", () => {
    if (overlay.classList.contains("force-portrait") || overlay.classList.contains("force-landscape")) {
      updateFramedSize();
    }
  });

  // 全画面表示モード: 上部バー・説明パネルを消して画面いっぱいに表示する。
  // 戻す導線として右上に小さな半透明ボタンを重ねて出す（Escapeキーでも戻せる）
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => enterFullscreenMode());
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("hide-topbar")) {
      exitFullscreenMode();
    }
  });

  // 評価とコメントは別々に操作できると誤解されやすかったので、
  // 「レビュー」1つのボタンにまとめた（開く先は同じモーダル。rate-modal.js）
  reviewBtn.addEventListener("click", () => {
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

function enterFullscreenMode() {
  const overlay = document.getElementById("player-overlay");
  const body = document.getElementById("player-body");
  if (!overlay || !body || overlay.classList.contains("hide-topbar")) return;
  overlay.classList.add("hide-topbar");
  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "btn btn-icon player-fs-exit-btn";
  exitBtn.id = "player-fs-exit-btn";
  exitBtn.setAttribute("aria-label", "全画面表示を終了");
  exitBtn.title = "全画面表示を終了（Escキーでも戻れます）";
  exitBtn.textContent = "⤢";
  exitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exitFullscreenMode();
  });
  body.appendChild(exitBtn);
}

function exitFullscreenMode() {
  const overlay = document.getElementById("player-overlay");
  if (!overlay) return;
  overlay.classList.remove("hide-topbar");
  document.getElementById("player-fs-exit-btn")?.remove();
}

export async function openPlayer(workId, { skipHistory = false } = {}) {
  const overlay = document.getElementById("player-overlay");
  const frameWrap = document.getElementById("player-frame-wrap");
  const titleEl = document.getElementById("player-title");
  const authorLinkEl = document.getElementById("player-author-link");
  const descDetailsEl = document.getElementById("player-desc");
  const descTextEl = document.getElementById("player-desc-text");

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

  // 説明文は入っていることに気づいてもらえていなかったので上部バーで読めるようにした。
  // 閉じている間（<details>のデフォルト状態）はゲーム画面を圧迫しない
  if (descDetailsEl && descTextEl) {
    const description = (work.description || "").trim();
    descTextEl.textContent = description;
    descDetailsEl.hidden = !description;
    descDetailsEl.open = false;
  }

  // 作者の公開プロフィール（author.html）へのリンク。表示名が未設定でも
  // author.htmlは開けるので、その場合は汎用の文言でリンクだけは出す。
  // 単なるテキストだと押せると気づかれにくかったので、チップ風の見た目と
  // 矢印（›）を付けて「押せるボタン」だとわかるようにしている
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
          ? `by ${profile.display_name} ›`
          : "作者ページを見る ›";
        authorLinkEl.hidden = false;
      });
  }

  // 新しい作品を開くときは、前の作品で選んでいた表示モードを引きずらない
  overlay.classList.remove("force-landscape", "hide-topbar");
  document.getElementById("player-landscape-btn")?.classList.remove("active");
  document.getElementById("player-fs-exit-btn")?.remove();

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

  updateFramedSize();
  updateSidePanels();

  if (!skipHistory) {
    history.pushState({ workId: work.id }, "", `?work=${work.id}`);
  }

  markPlayed(work.id);
  recordView(work.id);
}

// 縦画面（スマホ疑似）/ PC画面モードの枠のピクセルサイズを計算する。
// CSSのaspect-ratioだけに任せると、flexアイテムとしての幅が確定せず
// 枠が正しく表示されないブラウザがあったため、JSで確実に計算する。
const PORTRAIT_ASPECT = 9 / 16;
const LANDSCAPE_ASPECT = 16 / 9;

function updateFramedSize() {
  const overlay = document.getElementById("player-overlay");
  const frameWrap = document.getElementById("player-frame-wrap");
  if (!overlay || !frameWrap) return;

  const isPortrait = overlay.classList.contains("force-portrait");
  const isLandscape = overlay.classList.contains("force-landscape");
  if (!isPortrait && !isLandscape) {
    frameWrap.style.width = "";
    frameWrap.style.height = "";
    return;
  }
  const aspect = isPortrait ? PORTRAIT_ASPECT : LANDSCAPE_ASPECT;

  const body = document.getElementById("player-body") || frameWrap.parentElement;
  const rect = body.getBoundingClientRect();
  const margin = 32; // 枠の周りに少し余白を残す
  const availW = Math.max(240, rect.width - margin);
  const availH = Math.max(240, rect.height - margin);

  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }

  frameWrap.style.width = `${Math.round(w)}px`;
  frameWrap.style.height = `${Math.round(h)}px`;
}

// 縦画面モードの左右パネル（作者プロフィール／おすすめ作品）を更新する。
// 通常モードに戻すときは中身を消して隠すだけ（枠自体は毎回作り直す）
async function updateSidePanels() {
  const overlay = document.getElementById("player-overlay");
  const leftEl = document.getElementById("player-side-left");
  const rightEl = document.getElementById("player-side-right");
  if (!overlay || !leftEl || !rightEl) return;

  if (!overlay.classList.contains("force-portrait") || !currentWork) {
    leftEl.hidden = true;
    rightEl.hidden = true;
    leftEl.innerHTML = "";
    rightEl.innerHTML = "";
    return;
  }

  const work = currentWork;
  leftEl.hidden = false;
  rightEl.hidden = false;
  leftEl.innerHTML = "<p class='form-hint'>読み込み中…</p>";
  rightEl.innerHTML = "<p class='form-hint'>読み込み中…</p>";

  const [{ data: profile }, { data: recoWorks }] = await Promise.all([
    work.author_id
      ? supabase.from("profiles").select("display_name, bio").eq("id", work.author_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("works")
      .select("id, title, thumbnail_path")
      .eq("status", "published")
      .neq("id", work.id)
      .order("rating_bayes", { ascending: false })
      .limit(6),
  ]);

  if (currentWork?.id !== work.id) return; // 読み込み中に別作品へ切り替わっていたら反映しない

  leftEl.innerHTML = "";
  leftEl.appendChild(buildProfileSidePanel(work, profile));

  rightEl.innerHTML = "";
  const heading = document.createElement("div");
  heading.className = "player-side-heading";
  heading.textContent = "他のおすすめ作品";
  rightEl.appendChild(heading);
  if (recoWorks?.length) {
    for (const w of recoWorks) rightEl.appendChild(buildRecoSideItem(w));
  } else {
    const empty = document.createElement("p");
    empty.className = "form-hint";
    empty.textContent = "おすすめがまだありません。";
    rightEl.appendChild(empty);
  }
}

function buildProfileSidePanel(work, profile) {
  const wrap = document.createElement("div");

  const heading = document.createElement("div");
  heading.className = "player-side-heading";
  heading.textContent = "作者について";
  wrap.appendChild(heading);

  const card = document.createElement("div");
  card.className = "player-side-profile";

  const name = document.createElement("div");
  name.className = "player-side-profile-name";
  name.textContent = profile?.display_name ?? "名無し";
  card.appendChild(name);

  if (profile?.bio) {
    const bio = document.createElement("p");
    bio.className = "player-side-profile-bio";
    bio.textContent = profile.bio;
    card.appendChild(bio);
  }

  if (work.author_id) {
    const link = document.createElement("a");
    link.className = "btn";
    link.href = `author.html?id=${work.author_id}`;
    link.textContent = "作者の他の作品を見る";
    card.appendChild(link);
  }

  wrap.appendChild(card);
  return wrap;
}

function buildRecoSideItem(w) {
  const item = document.createElement("div");
  item.className = "player-side-reco-item";
  item.addEventListener("click", () => openPlayer(w.id));

  const thumb = document.createElement("div");
  thumb.className = "player-side-reco-thumb";
  if (w.thumbnail_path) {
    const img = document.createElement("img");
    img.src = w.thumbnail_path;
    img.loading = "lazy";
    img.alt = w.title;
    thumb.appendChild(img);
  }
  item.appendChild(thumb);

  const title = document.createElement("div");
  title.className = "player-side-reco-title";
  title.textContent = w.title;
  item.appendChild(title);

  return item;
}

export function closePlayer({ skipHistory = false } = {}) {
  const overlay = document.getElementById("player-overlay");
  const frameWrap = document.getElementById("player-frame-wrap");
  const authorLinkEl = document.getElementById("player-author-link");
  const rotateBtn = document.getElementById("player-rotate-btn");
  const landscapeBtn = document.getElementById("player-landscape-btn");
  const descDetailsEl = document.getElementById("player-desc");
  const descTextEl = document.getElementById("player-desc-text");

  // ここが要: src="" ではなく要素ごと除去する。裏で動かし続けると端末が熱くなるため
  frameWrap.innerHTML = "";
  overlay.hidden = true;
  authorLinkEl.hidden = true;
  if (descDetailsEl && descTextEl) {
    descDetailsEl.hidden = true;
    descDetailsEl.open = false;
    descTextEl.textContent = "";
  }
  overlay.classList.remove("force-portrait", "force-landscape", "hide-topbar");
  rotateBtn.classList.remove("active");
  landscapeBtn?.classList.remove("active");
  document.getElementById("player-fs-exit-btn")?.remove();
  frameWrap.style.width = "";
  frameWrap.style.height = "";
  const leftEl = document.getElementById("player-side-left");
  const rightEl = document.getElementById("player-side-right");
  if (leftEl) { leftEl.hidden = true; leftEl.innerHTML = ""; }
  if (rightEl) { rightEl.hidden = true; rightEl.innerHTML = ""; }
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
