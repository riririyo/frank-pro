/**
 * frank pro — 投稿HTML配信Worker
 *
 * 役割はふたつ:
 *   1. Supabase Storage（公開バケット）から作品HTMLを取り出し、隔離のためのヘッダを
 *      「必ず」付けて返す
 *   2. Cloudflareのエッジにキャッシュして、Supabase Storage側の帯域消費を抑える
 *      （投稿HTMLは一度置いたら書き換わらない前提なので、ある程度長いTTLで問題ない）
 *
 * ヘッダをストレージのオブジェクトメタデータ任せにしないのがポイント。
 * 付け忘れが起きた瞬間に、投稿HTMLが配信ドメインの正規オリジンとして動いてしまう。
 *
 * 根拠と各ヘッダの意図: docs/security-design.md 1章
 * 特に重要な2点:
 *   1. `sandbox` はレスポンスヘッダで付ける（iframe属性だけでは直接アクセス時に効かない）
 *   2. `allow-same-origin` は絶対に付けない（付けるとlocalStorage/Cookie/同一オリジンの
 *      他作品に触れてしまう。副作用としてlocalStorageに触れず、投稿ガイドラインで明記済み）
 *
 * ストレージにR2ではなくSupabase Storageを使っている理由: docs/security-design.md 1-1節末尾
 * （R2は無料枠でもカード登録が必須で、超過時に上限なく自動課金される。個人開発の初期段階では
 *   カード登録不要・超過時は課金ではなく制限がかかるSupabase Storageを優先した）
 *
 * キャッシュTTLについて: docs/security-design.md 1-1節末尾
 * 長くしすぎると通報対応で消したはずの作品が古いキャッシュから配信され続けるリスクがある。
 * 短くしすぎると帯域節約の意味が薄れる。1時間を初期値としている。
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

// エッジキャッシュのTTL（秒）。docs/security-design.md 1-1節末尾の理由でこの値にしている。
const EDGE_CACHE_TTL_SECONDS = 3600;

export default {
  /**
   * @param {Request} request
   * @param {{ SUPABASE_STORAGE_BASE_URL: string, FRAME_ANCESTOR: string }} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    // 期待するパス形式: /w/<work_id>.html
    const match = url.pathname.match(/^\/w\/([A-Za-z0-9_-]+)\.html$/);
    if (!match) {
      return new Response("not found", { status: 404 });
    }

    // Cloudflareのエッジキャッシュを自前で管理する（Cache API）。
    // 投稿HTMLは書き換わらないのでヒットすればSupabase側の帯域を一切使わない。
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const objectUrl = `${env.SUPABASE_STORAGE_BASE_URL}/${match[1]}.html`;
    // Cloudflare側の別のキャッシュ層（cf.cacheTtl）は使わず、上のCache APIだけで一元管理する
    const origin = await fetch(objectUrl, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!origin.ok) {
      return new Response("not found", { status: origin.status === 404 ? 404 : 502 });
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
    headers.set("cache-control", `public, max-age=${EDGE_CACHE_TTL_SECONDS}, immutable`);

    const response = new Response(origin.body, { headers, status: 200 });

    // GETのみキャッシュに保存する（HEADは保存しない）。保存はレスポンスを返した後でよい。
    if (request.method === "GET") {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
};
