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
 * 【管理者プレビュー（緊急確認用）について】
 * 「削除・非公開にした作品の中身を、管理者だけは後から確認できるようにしたい
 * （通報された内容が実際どのくらい酷いか等の緊急確認用。普段は使わない）」という
 * 要望に対応するため、`?preview=<exp>.<署名>` というクエリパラメータを検証し、
 * 有効なら works.status のチェックをこのリクエスト限りで素通りさせる仕組みを追加した。
 * トークンは supabase/functions/admin-action（is_admin確認済み）が
 * ADMIN_PREVIEW_SECRET（WorkerとEdge Functionの両方に設定する共有シークレット）で
 * HMAC-SHA256署名して発行し、有効期限は5分と短い。
 * 重要なのは「管理者プレビューでもCSP sandbox等の隔離ヘッダは通常配信と全く同じものを
 * 付ける」という点（このファイル最上部の設計意図がここでも崩れないようにするため）。
 * 署名付きURLをそのまま直接開く方式（Supabase Storageの一時署名URLを管理画面が
 * 直接開く）も検討したが、その場合このWorkerを経由しないためsandbox等のヘッダが
 * 一切付かない状態でHTMLが開かれてしまう。緊急時とはいえ普段はまず使わない機能に
 * わざわざ隔離を犠牲にする理由はないため、このWorker経由の方式にした。
 * また悪用防止のため、プレビュー配信はエッジキャッシュに一切乗せない
 * （読み込みも書き込みもスキップし、Cache-Control: private, no-store を明示する）。
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

// 管理者プレビュートークンの検証。ADMIN_PREVIEW_SECRETが設定されていない、
// トークンの形式が不正、期限切れ、署名不一致のいずれかであれば false を返す
// （＝通常どおりpublished判定に従う。プレビューは絶対に「フェイルオープン」させない）。
async function verifyPreviewToken(secret, workId, token) {
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) return false;

  const expected = await hmacSign(secret, `${workId}.${expStr}`);
  return timingSafeEqual(expected, sig);
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64url(new Uint8Array(sigBuf));
}

function base64url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  /**
   * @param {Request} request
   * @param {{ SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string, FRAME_ANCESTOR: string, ADMIN_PREVIEW_SECRET: string }} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }

    const url = new URL(request.url);

    // 管理画面のシステム状態チェックパネル用の軽量ヘルスチェック。
    // シークレットの値は一切返さず「設定されているか」のbooleanだけ返す。
    // 管理画面（サイト本体ドメイン）から別ドメインのこのWorkerへfetchで
    // 読みに行くため、CORSヘッダを付けている（値を含まないのでオリジン制限はしていない）。
    if (url.pathname === "/health") {
      const supabaseUrlSet = Boolean(env.SUPABASE_URL);
      const serviceRoleSet = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
      const ok = supabaseUrlSet && serviceRoleSet;
      return new Response(
        JSON.stringify({ ok, supabase_url_set: supabaseUrlSet, service_role_set: serviceRoleSet }),
        {
          status: ok ? 200 : 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // 期待するパス形式: /w/<work_id>.html
    const match = url.pathname.match(/^\/w\/([A-Za-z0-9_-]+)\.html$/);
    if (!match) {
      return new Response("not found", { status: 404 });
    }
    const workId = match[1];

    // 管理者プレビュー（緊急確認用）かどうかを先に判定しておく。
    // 有効なトークンがあるリクエストはエッジキャッシュを一切使わない（読み書きとも）。
    const isAdminPreview = await verifyPreviewToken(
      env.ADMIN_PREVIEW_SECRET,
      workId,
      url.searchParams.get("preview")
    );

    // Cloudflareのエッジキャッシュを自前で管理する（Cache API）。
    // 投稿HTMLは書き換わらないのでヒットすればSupabase側の帯域を一切使わない。
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    if (!isAdminPreview) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
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
    //    実体が残っていてもこのWorker経由では一切配信しない
    //    （ただし有効な管理者プレビュートークンがある場合はこの判定を素通りする）。
    const statusRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/works?id=eq.${encodeURIComponent(workId)}&select=status`,
      { headers: authHeaders, cf: { cacheTtl: 0, cacheEverything: false } }
    );
    if (!statusRes.ok) {
      return new Response("not found", { status: 502 });
    }
    const rows = await statusRes.json();
    if (!rows.length) {
      return new Response("not found", { status: 404 });
    }
    if (rows[0].status !== "published" && !isAdminPreview) {
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

    if (isAdminPreview) {
      // 管理者プレビューはCDN・ブラウザのどちらにもキャッシュさせない
      headers.set("cache-control", "private, no-store");
    } else {
      headers.set("cache-control", `public, max-age=${EDGE_CACHE_TTL_SECONDS}, immutable`);
    }

    const response = new Response(origin.body, { headers, status: 200 });

    // GETのみキャッシュに保存する（HEADは保存しない）。管理者プレビューは保存しない。保存はレスポンスを返した後でよい。
    if (request.method === "GET" && !isAdminPreview) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
};
