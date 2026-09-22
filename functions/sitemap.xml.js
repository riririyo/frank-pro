// frank pro — sitemap.xml の動的生成
// works テーブルから status='published' の作品一覧を取得し、トップページ・各作品ページの
// URLを列挙したXMLを返す。functions/_lib/ogp.js と同じくPages Functionsで実装する。

const SUPABASE_URL = "https://tvaadeaojsolxsmmyznz.supabase.co";
// anon keyはクライアント側(web/js/config.js)にも公開済みの値と同じもの。
// service_roleではないので、ここに書いても情報漏洩にはならない。
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2YWFkZWFvanNvbHhzbW15em56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzcxMTQsImV4cCI6MjEwNDcxMzExNH0.dpMwe2MsRsiPnpJzNRuTZaGIdrnb34ZpEtpKHm_rtUk";

export async function onRequestGet(context) {
  const { request } = context;
  const origin = new URL(request.url).origin;

  const urls = [`${origin}/`];

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/works?status=eq.published&select=id,updated_at&order=updated_at.desc&limit=5000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (res.ok) {
      const works = await res.json();
      for (const w of works) {
        urls.push({ loc: `${origin}/?work=${encodeURIComponent(w.id)}`, lastmod: w.updated_at });
      }
    }
  } catch (e) {
    console.error("sitemap: works fetch failed", e);
    // 失敗してもトップページだけのsitemapを返す（空より良い）
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) =>
    typeof u === "string"
      ? `  <url><loc>${esc(u)}</loc></url>`
      : `  <url><loc>${esc(u.loc)}</loc><lastmod>${esc(u.lastmod)}</lastmod></url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
