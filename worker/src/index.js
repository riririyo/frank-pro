/**
 * frank pro — 投稿HTML配信Worker
 *
 * 役割は主に3つ:
 *   1. Supabase Storage（非公開バケット）から作品HTMLをservice_role権限で取り出し、
 *      隔離のためのヘッダを「必ず」付けて返す
 *   2. works.status が 'published' の作品だけを配信する（削除・非公開の作品は
 *      たとえHTMLの実体がストレージに残っていても、このWorker経由では一切見えない）
 *   3. Cloudflareのエッジにキャッシュして、Supabase Storage側の帯域消費を抑える
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
 * 【非公開バケット化について（重要）】
 * worksバケットは以前 public: true で作成されていたが、これだと
 *   {SUPABASE_URL}/storage/v1/object/public/works/<id>.html
 * という認証不要のURLを直接叩けば、このWorkerを完全に迂回してヘッダなしでHTMLの
 * 実体が取れてしまっていた（= このファイルが実装しているsandbox等のヘッダが
 * 一切効かない状態）。加えて「削除」した作品もこの直リンク経由なら見えてしまっていた。
 * supabase/migrations/0010_private_works_bucket.sql でバケットをpublic: falseに
 * 変更したため、このWorkerはservice_role keyを使った認証付きダウンロードに
 * 切り替える必要があり、それを実装したのがこのファイル。
 * また、認証だけでなく works.status を毎回サーバー側（service_role、RLSバイパス）で
 * 確認し、'published' 以外は404にすることで、「削除後は管理者以外アクセス不可」を
 * このWorkerの層でも保証している。
 *
 * ストレージにR2ではなくSupabase Storageを使っている理由: docs/security-design.md 1-1節末尾
 * （R2は無料枠でもカード登録が必須で、超過時に上限なく自動課金される。個人開発の初期段階では
 *   カード登録不要・超過時は課金ではなく制限がかかるSupabase Storageを優先した）
 *
 * キャッシュTTLについて: docs/security-design.md 1-1節末尾
 * 長くしすぎると通報対応で消したはずの作品が古いキャッシュから配信され続けるリスクがある。
 * 短くしすぎると帯域節約の意味が薄れる。1時間を初期値としている。
 * （なお、削除直後から最大1時間はエッジキャッシュから配信され得るという残存リスクは
 *   このTTLを受け入れている前提で許容している。緊急時はCloudflareダッシュボードから
 *   キャッシュパージで即座に消せる）
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
   * @param {{ SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string, FRAME_ANCESTOR: string }} env
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
    const workId = match[1];

    // Cloudflareのエッジキャッシュを自前で管理する（Cache API）。
    // 投稿HTMLは書き換わらないのでヒットすればSupabase側の帯域を一切使わない。
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      // 設定漏れ。ここでこけると全作品が見れなくなるので、原因が分かるメッセージにしておく
      return new Response("worker misconfigured", { status: 500 });
    }

    const authHeaders = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    };

    // 1. works.status を service_role（RLSバイパス）で確認する。
    //    'published' 以外（非公開・削除済み・審査待ちなど）は、たとえバケットの
    //    実体が残っていてもこのWorker経由では一切配信しない。
    const statusRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/works?id=eq.${encodeURIComponent(workId)}&select=status`,
      { headers: authHeaders, cf: { cacheTtl: 0, cacheEverything: false } }
    );
    if (!statusRes.ok) {
      return new Response("not found", { status: 502 });
    }
    const rows = await statusRes.json();
    if (!rows.length || rows[0].status !== "published") {
      return new Response("not found", { status: 404 });
    }

    // 2. 非公開バケットから、service_role権限の認証付きダウンロードエンドポイントで取得する
    //    （publicエンドポイントと違い、誰でも直接叩けるURLではない）
    const objectUrl = `${env.SUPABASE_URL}/storage/v1/object/works/${workId}.html`;
    const origin = await fetch(objectUrl, {
      headers: authHeaders,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
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
