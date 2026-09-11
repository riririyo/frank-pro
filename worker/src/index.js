/**
 * frank pro — 投稿HTML配信Worker
 *
 * 役割はひとつだけ: R2から作品HTMLを取り出し、隔離のためのヘッダを「必ず」付けて返す。
 * このヘッダをR2のオブジェクトメタデータ任せにしないのがポイント。
 * 付け忘れが起きた瞬間に、投稿HTMLが配信ドメインの正規オリジンとして動いてしまう。
 *
 * 根拠と各ヘッダの意図: docs/security-design.md 1章
 * 特に重要な2点:
 *   1. `sandbox` はレスポンスヘッダで付ける（iframe属性だけでは直接アクセス時に効かない）
 *   2. `allow-same-origin` は絶対に付けない（付けるとlocalStorage/Cookie/同一オリジンの
 *      他作品に触れてしまう。副作用としてlocalStorageに触れず、投稿ガイドラインで明記済み）
 */

const SECURITY_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-site",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), midi=(), display-capture=(), idle-detection=()",
  // CSPは複数行に分けて書けないので1行にまとめる
  "Content-Security-Policy": [
    "sandbox allow-scripts allow-pointer-lock",
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    // frame-ancestors は本番デプロイ時に本体ドメインへ差し替える（wrangler.tomlのvarsで注入）
    "frame-ancestors https://frank.pro",
    "webrtc 'block'",
  ].join("; "),
};

export default {
  /**
   * @param {Request} request
   * @param {{ WORKS_BUCKET: R2Bucket, FRAME_ANCESTOR: string }} env
   */
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    // 期待するパス形式: /w/<work_id>.html
    const match = url.pathname.match(/^\/w\/([A-Za-z0-9_-]+)\.html$/);
    if (!match) {
      return new Response("not found", { status: 404 });
    }
    const objectKey = `works/${match[1]}.html`;

    const object = await env.WORKS_BUCKET.get(objectKey);
    if (!object) {
      return new Response("not found", { status: 404 });
    }

    const headers = new Headers(SECURITY_HEADERS);
    if (env.FRAME_ANCESTOR) {
      headers.set(
        "Content-Security-Policy",
        headers
          .get("Content-Security-Policy")
          .replace("https://frank.pro", env.FRAME_ANCESTOR)
      );
    }
    // R2のETag/キャッシュ情報は活かす（内容は変えない）
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=300, must-revalidate");

    return new Response(object.body, { headers });
  },
};
