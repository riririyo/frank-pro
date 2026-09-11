# frank pro

HTMLで作ったゲーム・プロダクトを、投稿はログイン必須・閲覧とプレイと評価とコメントは
誰でも自由で扱う投稿プラットフォーム。

設計判断の経緯と根拠は `docs/frank-pro-handoff.md` に全部書いてある。実装で迷ったら先にそこを読む。

**運営ポリシー：セキュリティ上の不正は全力で防ぐが、それ以外の不正（票の水増し・スパム）は許容する。**

---

## ディレクトリ構成

```
frank-pro/
├─ web/              Cloudflare Pages にデプロイする静的サイト（ビルド不要・素のHTML/JS）
├─ worker/           Supabase Storageの前に置くCloudflare Worker（配信ヘッダの強制。ここがセキュリティの要）
├─ supabase/
│   ├─ migrations/   テーブル定義・RLS・RPC関数
│   └─ functions/    Edge Function（署名URL発行、コメント投稿）
├─ scripts/daily/    日次バッチ（サムネ生成・ベイズ平均再計算・古いログの削除）
├─ .github/workflows/daily.yml   ↑を毎日実行するGitHub Actions
└─ docs/             設計文書一式（セキュリティ設計・規約叩き台・投稿ガイドライン叩き台）
```

---

## セットアップ手順

### 1. アカウント準備

- [ ] GitHub アカウント（このリポジトリを push する）
- [ ] Cloudflare アカウント（Pages / Workers。無料枠にカード登録不要）
- [ ] Supabase アカウント（プロジェクトを作成。リージョンは Tokyo を選ぶ）
- [ ] ドメイン（例: `frank.pro`）— サイト本体用と作品配信用で**サブドメインを分ける**
      （例: `frank.pro` と `works.frank.pro`。docs/security-design.md 1-1節）

各サービスの無料枠の数字は変わるので、着手前に公式ページで確認すること。

### 2. Supabase

```bash
npm install -g supabase
supabase login
supabase link --project-ref <あなたのproject-ref>
supabase db push          # migrations/ を適用
supabase functions deploy sign-upload
supabase functions deploy submit-comment
```

`sign-upload` はSupabase Storageの署名付きアップロードURLを発行するだけなので、
追加の環境変数は不要。`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Supabase が
自動で渡す。

Auth の設定（Supabase ダッシュボード > Authentication）:
- Email OTP（マジックリンク）を有効化
- Redirect URLs に本番サイトの `submit.html` を追加

### 3. Cloudflare Worker（配信）

```bash
cd worker
npm install
npx wrangler deploy
```

`wrangler.toml` の `[vars]` にある `SUPABASE_STORAGE_BASE_URL` を、実際のSupabaseプロジェクトの
Storage公開URL（例: `https://xxxxxxxx.supabase.co/storage/v1/object/public/works`）に書き換える。
`routes` も実際のドメインに合わせて有効化し、`works.frank.pro` のようなサブドメインを
このWorkerにルーティングする。

**デプロイしたら必ず確認すること**（docs/security-design.md 1章）:
テスト用のHTMLを1本置いて、ブラウザの開発者ツールで
`Content-Security-Policy: sandbox ...` ヘッダが実際に返っているか、
そのHTML内で `console.log(window.origin)` が `null` になるか（opaque origin）を確認する。
ここが効いていない状態で投稿を受け付けない。

### 4. Cloudflare Pages（サイト本体）

1. `web/js/config.js` を実際の値に書き換える（SUPABASE_URL, SUPABASE_ANON_KEY, WORKS_BASE_URL など）
2. GitHubにpushする
3. Cloudflare Pages でこのリポジトリを接続し、ビルド設定は「なし（静的ファイル）」、公開ディレクトリを `web` に設定
4. push するたびに自動デプロイされる

### 5. GitHub Actions（日次バッチ）

リポジトリの Settings > Secrets and variables > Actions に登録:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
WORKS_BASE_URL
```

`.github/workflows/daily.yml` が毎日自動実行する。手動実行は Actions タブから
「Run workflow」でも可能。

---

## ローカルでの確認

`web/` はビルド不要の静的ファイルなので、適当な静的サーバーで開けば動作確認できる
（ただし `config.js` の値を実際のSupabaseプロジェクトに向けておく必要がある）。

```bash
cd web
python3 -m http.server 8788
# http://localhost:8788 を開く
```

---

## 実装の状態（このリポジトリで作られているもの）

- [x] Supabase スキーマ・RLS・RPC関数（works, ratings, comments, featured, site_stats）
- [x] Cloudflare Worker（Supabase Storage配信時のセキュリティヘッダ強制）
- [x] 投稿用 Edge Function（署名URL発行、サイズ検証）
- [x] コメント投稿 Edge Function（IP/UAをサーバー側で記録）
- [x] 一覧ページ（4種の並べ替え、無限スクロール）
- [x] 作品プレイヤー（iframe隔離、URL連動、既プレイマーク）
- [x] 星評価（匿名可・全票同一重み・ベイズ平均）
- [x] コメント（匿名可・事前審査なし・作者による非表示・通報3件で自動非表示）
- [x] 投稿フロー（縦持ちプレビュー必須、チェックリスト、静的警告）
- [x] 「適当に遊ぶ」ボタン
- [x] 作者ページ
- [x] 日次バッチ（サムネ生成・ベイズ平均再計算・古いログ削除）
- [x] 利用規約・投稿ガイドラインのページ化

## まだ手を付けていないもの

- [ ] 「今週の frank」枠（featuredテーブルは用意済み。管理画面がないので、当面は
      Supabaseダッシュボードから直接 `featured` テーブルに行を追加する運用）
- [ ] ログイン方法の追加（現状マジックリンクのみ。SNSログインを足す場合は `web/js/auth.js`）
- [ ] サムネイルの手動差し替えUI（投稿時のアップロードは未実装。現状は自動生成のみ）
- [ ] favicon / OGP画像
- [ ] 実際のドメイン取得と本番デプロイ

## ドキュメント

- `docs/frank-pro-handoff.md` — 企画全体の引き継ぎまとめ。最初に読む
- `docs/security-design.md` — セキュリティ設計の根拠と残存リスク
- `docs/terms-of-service-draft.md` — 利用規約の叩き台（法律の専門家の確認は未受）
- `docs/posting-guideline-draft.md` — 投稿ガイドラインの叩き台
