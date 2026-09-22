// frank pro — サイト全体のダーク/ライトテーマ切り替え
//
// もともとCSS変数 + prefers-color-scheme（OS設定）だけでダーク対応していたが、
// OS設定に関わらず手動で切り替えたいという要望に対応するため、
// <html data-theme="dark|light">を明示的に付けるトグルボタンをヘッダーに追加する。
// 保存先はlocalStorage（サーバー同期はしない。端末ごとの見た目の好みなので十分）。
//
// 全ページ共通のヘッダー（.header-actions）に差し込む想定。
// 各HTMLの<script type="module">からinitThemeToggle()を呼ぶだけで動く。

const STORAGE_KEY = "frankpro_theme"; // "dark" | "light"（未設定ならOS設定に従う）

export function initThemeToggle() {
  applyStoredTheme();
  injectToggleButton();
}

function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function applyStoredTheme() {
  const stored = getStoredTheme();
  if (stored) document.documentElement.setAttribute("data-theme", stored);
}

function currentEffectiveTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* 保存できなくても致命的ではない（次回起動時にOS設定に戻るだけ） */
  }
}

function injectToggleButton() {
  const slot = document.querySelector(".header-actions");
  if (!slot) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-icon theme-toggle-btn";

  const render = () => {
    const isDark = currentEffectiveTheme() === "dark";
    btn.textContent = isDark ? "☀️" : "🌙";
    btn.setAttribute("aria-label", isDark ? "ライトモードに切り替え" : "ダークモードに切り替え");
    btn.title = isDark ? "ライトモードに切り替え" : "ダークモードに切り替え";
  };
  render();

  btn.addEventListener("click", () => {
    setTheme(currentEffectiveTheme() === "dark" ? "light" : "dark");
    render();
  });

  slot.insertBefore(btn, slot.firstChild);
}
