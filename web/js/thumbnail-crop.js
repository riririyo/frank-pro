// frank pro — サムネイルの切り出し（クロップ）モーダル
//
// アップロードされた画像は縦長のスクリーンショットなどのことも多いが、
// 一覧・マイページのサムネイルは横長（4:3）で表示される。
// これまでは単純に中央基準でリサイズ・切り抜きしていたため、意図しない
// 部分（顔が切れる、など）がサムネイルになることがあった。
// このモーダルで、ユーザー自身がドラッグ・ズームして「どの範囲を
// 横長サムネイルにするか」を選べるようにする。
//
// 使い方: const file = await cropThumbnailImage(originalFile);
//   file が null ならユーザーがキャンセルした（呼び出し側は何もしない）。

const THUMB_ASPECT = 4 / 3; // .work-thumb-wrap（styles.css）と合わせる
const OUTPUT_WIDTH = 960;
const OUTPUT_HEIGHT = Math.round(OUTPUT_WIDTH / THUMB_ASPECT);

export function cropThumbnailImage(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);

    const overlay = document.createElement("div");
    overlay.className = "thumb-crop-overlay";
    overlay.innerHTML = `
      <div class="thumb-crop-modal">
        <div class="thumb-crop-header">
          <span>サムネイルの範囲を選択</span>
          <button type="button" class="btn btn-icon" data-action="cancel" aria-label="閉じる">✕</button>
        </div>
        <div class="thumb-crop-frame">
          <img class="thumb-crop-img" alt="" draggable="false" />
        </div>
        <p class="form-hint">ドラッグして位置を調整、スライダーで拡大できます。</p>
        <div class="thumb-crop-controls">
          <span class="thumb-crop-zoom-label">ズーム</span>
          <input type="range" class="thumb-crop-zoom" min="1" max="3" step="0.01" value="1" />
        </div>
        <div class="thumb-crop-actions">
          <button type="button" class="btn" data-action="cancel">キャンセル</button>
          <button type="button" class="btn btn-primary" data-action="confirm">この範囲を使う</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const imgEl = overlay.querySelector(".thumb-crop-img");
    const frameEl = overlay.querySelector(".thumb-crop-frame");
    const zoomInput = overlay.querySelector(".thumb-crop-zoom");

    let naturalW = 0;
    let naturalH = 0;
    let baseScale = 1;
    let scale = 1;
    let tx = 0;
    let ty = 0;
    let frameW = 0;
    let frameH = 0;

    function cleanup(result) {
      URL.revokeObjectURL(objectUrl);
      overlay.remove();
      resolve(result);
    }

    function applyTransform() {
      imgEl.style.width = `${naturalW * scale}px`;
      imgEl.style.height = `${naturalH * scale}px`;
      imgEl.style.left = `${tx}px`;
      imgEl.style.top = `${ty}px`;
    }

    function clampTranslate() {
      const dispW = naturalW * scale;
      const dispH = naturalH * scale;
      const minTx = Math.min(0, frameW - dispW);
      const minTy = Math.min(0, frameH - dispH);
      tx = Math.max(minTx, Math.min(0, tx));
      ty = Math.max(minTy, Math.min(0, ty));
    }

    function recenter() {
      const dispW = naturalW * scale;
      const dispH = naturalH * scale;
      tx = (frameW - dispW) / 2;
      ty = (frameH - dispH) / 2;
      clampTranslate();
    }

    imgEl.addEventListener("load", () => {
      naturalW = imgEl.naturalWidth;
      naturalH = imgEl.naturalHeight;
      const rect = frameEl.getBoundingClientRect();
      frameW = rect.width;
      frameH = rect.height;
      baseScale = Math.max(frameW / naturalW, frameH / naturalH);
      scale = baseScale;
      zoomInput.value = "1";
      recenter();
      applyTransform();
    });
    imgEl.src = objectUrl;

    zoomInput.addEventListener("input", () => {
      scale = baseScale * Number(zoomInput.value);
      recenter();
      applyTransform();
    });

    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startTx = 0;
    let startTy = 0;

    frameEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      startTx = tx;
      startTy = ty;
      frameEl.setPointerCapture(e.pointerId);
    });
    frameEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      tx = startTx + (e.clientX - dragStartX);
      ty = startTy + (e.clientY - dragStartY);
      clampTranslate();
      applyTransform();
    });
    const endDrag = () => {
      dragging = false;
    };
    frameEl.addEventListener("pointerup", endDrag);
    frameEl.addEventListener("pointercancel", endDrag);

    overlay.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "cancel") {
        cleanup(null);
      } else if (action === "confirm") {
        const sx = -tx / scale;
        const sy = -ty / scale;
        const sw = frameW / scale;
        const sh = frameH / scale;

        const canvas = document.createElement("canvas");
        canvas.width = OUTPUT_WIDTH;
        canvas.height = OUTPUT_HEIGHT;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              cleanup(file); // 失敗時は元のファイルをそのまま渡す
              return;
            }
            const newName = file.name.replace(/\.[^.]+$/, "") + "-crop.jpg";
            cleanup(new File([blob], newName, { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.9
        );
      }
    });
  });
}
