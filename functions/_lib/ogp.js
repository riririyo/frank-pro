// frank pro — 個別作品リンクのOGP動的差し込み
//
// なぜ必要か:
// X/LINE/Discord等のリンクカードは、クローラーがURLをJS実行なしで取得して
// <head>のog:xxxタグを読むだけ。frank proは一覧ページがJSで作品を後から
// 読み込むSPAなので、何もしないと共有時に常に同じ汎用タグしか出せない。
//
// ここでは Cloudflare Pages Functions（advanced mode）を使い、
// `/?work=<id>` へのリクエストを横取りして、静的なindex.htmlを取得したあと
// HTMLRewriterでその作品のタイトル・説明・サムネイルURLを<head>に追記して返す。
// work パラメータが無ければ、素通りで通常のindex.htmlを返す（コストゼロ）。
//
// サムネイルはworks.thumbnail_pathにSupabase Storageの公開URLがそのまま
// 入っている前提（scripts/daily/generate-thumbnails.mjs参照）。
// 投稿直後で日次バッチが未実行の場合はthumbnail_pathがnullなので、
// その場合はog:imageを省略する（画像なしのテキストカードにフォールバック）。

const SUPABASE_URL = "https://tvaadeaojsolxsmmyznz.supabase.co";
// anon keyはクライアント側(web/js/config.js)にも公開済みの値と同じもの。
// service_roleではないので、ここに書いても情報漏洩にはならない。
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2YWFkZWFvanNvbHhzbW15em56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzcxMTQsImV4cCI6MjEwNDcxMzExNH0.dpMwe2MsRsiPnpJzNRuTZaGIdrnb34ZpEtpKHm_rtUk";

export async function handleOgp(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const workId = url.searchParams.get("work");

  // env.ASSETS は Pages Functions で自動的に使える、静的アセット取得用のバインディング
  const assetResponse = await env.ASSETS.fetch(request);

  if (!workId) return assetResponse;

  try {
    const apiUrl =
      `${SUPABASE_URL}/rest/v1/works` +
      `?id=eq.${encodeURIComponent(workId)}` +
      `&status=eq.published` +
      `&select=id,title,description,thumbnail_path`;

    const res = await fetch(apiUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return assetResponse;

    const rows = await res.json();
    const work = Array.isArray(rows) ? rows[0] : null;
    if (!work) return assetResponse;

    const title = `${work.title} — frank pro`;
    const rawDescription = (work.description || "").trim();
    const description = rawDescription
      ? rawDescription.slice(0, 140)
      : "frank proで今すぐ遊べる投稿ゲーム・プロダクト";
    const pageUrl = `${url.origin}/?work=${encodeURIComponent(work.id)}`;
    const image = work.thumbnail_path || null;

    let headTags = `
<meta property="og:type" content="website">
<meta property="og:site_name" content="frank pro">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">`;

    if (image) {
      headTags += `
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">`;
    } else {
      headTags += `
<meta name="twitter:card" content="summary">`;
    }

    class TitleRewriter {
      element(el) {
        el.setInnerContent(title);
      }
    }
    class HeadRewriter {
      element(el) {
        el.append(headTags, { html: true });
      }
    }

    return new HTMLRewriter()
      .on("title", new TitleRewriter())
      .on("head", new HeadRewriter())
      .transform(assetResponse);
  } catch (e) {
    // 何が起きても壊れた共有カードより通常ページの方がマシなので、素通りにする
    console.error("OGP rewrite failed", e);
    return assetResponse;
  }
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
