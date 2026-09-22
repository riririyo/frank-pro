// frank pro — 共有ボタン（評価/通報モーダル共通）
//
// Web Share API対応環境（主にスマホ）ではネイティブの共有シートを出し、
// 非対応環境（多くのPCブラウザ）ではURLをクリップボードにコピーする。
// リンク先は index.html?work=<id>（player.jsのinitPlayer()が
// ?workパラメータを見て自動的にその作品を開く仕組みを流用している）。

export function buildShareButton(workId, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-icon";
  btn.textContent = "🔗";
  btn.setAttribute("aria-label", "この作品を共有");
  btn.title = "この作品を共有";

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const url = buildWorkUrl(workId);

    if (navigator.share) {
      try {
        await navigator.share({ title: title || "frank html", url });
      } catch {
        /* ユーザーが共有をキャンセルしただけの場合も含む。何もしない */
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      const original = btn.textContent;
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    } catch {
      window.prompt("このURLをコピーしてください", url);
    }
  });

  return btn;
}

function buildWorkUrl(workId) {
  const dir = location.pathname.replace(/[^/]*$/, "");
  return `${location.origin}${dir}index.html?work=${encodeURIComponent(workId)}`;
}
