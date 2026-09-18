// frank pro — 作品カードの説明文表示
//
// 投稿時に書いた説明文が一覧・作者ページのカードで見えなかったので追加。
// 長い説明文はカードを圧迫しないよう省略し、「…」を押すと続きを読める。
// カードそのものはクリックでプレイ画面が開くので、説明文エリアのクリックは
// stopPropagationしてプレイ開始と衝突しないようにする。

const EXCERPT_LENGTH = 42;

export function buildWorkDescEl(description) {
  const trimmed = (description ?? "").trim();
  if (!trimmed) return null;

  const el = document.createElement("div");
  el.className = "work-desc";
  el.addEventListener("click", (e) => e.stopPropagation());

  if (trimmed.length <= EXCERPT_LENGTH) {
    el.textContent = trimmed;
    return el;
  }

  let expanded = false;
  const textSpan = document.createElement("span");
  const moreBtn = document.createElement("span");
  moreBtn.className = "work-desc-more";
  moreBtn.setAttribute("role", "button");
  moreBtn.tabIndex = 0;

  const render = () => {
    if (expanded) {
      textSpan.textContent = trimmed;
      moreBtn.hidden = true;
    } else {
      textSpan.textContent = trimmed.slice(0, EXCERPT_LENGTH);
      moreBtn.hidden = false;
      moreBtn.textContent = "…";
    }
  };
  render();

  const toggle = (e) => {
    e.stopPropagation();
    expanded = !expanded;
    render();
  };
  moreBtn.addEventListener("click", toggle);
  moreBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(e);
    }
  });

  el.appendChild(textSpan);
  el.appendChild(moreBtn);
  return el;
}
