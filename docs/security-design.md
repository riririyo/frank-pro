# セキュリティ設計 — 投稿HTMLのホスティングと匿名投稿の防御

作成日：2026-09-11 / 対象：HTMLゲーム投稿プラットフォーム（frank pro）

前提：星評価もコメントもログイン不要、全票同一重み。投稿のみログイン必須。
方針：**セキュリティ上の不正は全力で防ぐ。それ以外の不正（票の水増し、スパム）は許容する。**

---

## 1. 投稿HTMLの隔離

### 1-1. 方針の根拠

Google が公開している「Securely hosting user data in modern web applications」が、
ユーザーが自由に書いたHTMLをホストする場合の標準的な手順をまとめている。要点は3つ。

1. **配信ドメインを本体から分ける**（クロスサイト隔離）
2. **`Content-Security-Policy: sandbox` をレスポンスヘッダで付ける**
   （iframeの `sandbox` 属性だけでは、ファイルを直接開かれたときに効かない）
3. さらに強くしたい場合は Public Suffix List 登録 ＋ shim パターン

本サービスは 1 と 2 を採用する。3 は後述の理由で初期は不要。

### 1-1-補. ストレージにR2ではなくSupabase Storageを使う理由

投稿HTML本体の置き場所は、当初 Cloudflare R2（転送量課金ゼロ）を予定していたが、
調査の結果 Supabase Storage に変更した。理由は課金リスク。

- **R2 は無料枠でもカード登録が必須。** さらに無料枠を超えても「そこで止まる」ハード上限がなく、
  超過分は自動的に課金される。個人開発の初期段階、しかもバズって想定外のアクセスが来た場合に
  上限なく請求が発生しうる構造は避けたい
- **Supabase Storage は無料枠にカード登録が不要。** 無料枠（プロジェクト全体でストレージ1GB、
  月間帯域5GB、ファイル1件50MB）を超えても自動課金はされず、猶予期間の後に読み取り専用へ
  移行する（＝止まるだけで請求は来ない）
- Cloudflare Workers / Pages はもともと無料枠にカード登録不要で、超過時も課金ではなくエラーで
  弾かれるだけ。今回の変更で「関わるサービス全部がカード登録不要」に揃った

**帯域の実効値について。** アプリ側のファイルサイズ上限は1件10MBだが、実際にこれまで作った
HTMLゲームを確認したところ最大でも431,944バイト（0.4MB程度）で、10MBの上限には遠く及ばない。
月間帯域5GBという枠は、1ファイル数百KB前提であれば数千〜1万PV相当の余裕がある計算になる
（Cloudflare Worker のエッジキャッシュがヒットすればSupabase側の帯域はさらに消費しない）。
数字は今後実測して調整する。

**配信方式。** Cloudflare Worker に R2 バインディングを持たせる代わりに、Worker から
Supabase Storage の公開URLへ `fetch` する「Workerを純粋なリバースプロキシとして使う」
構成にした。ヘッダ強制の役割・実装（下記1-3節）は変わらない。ストレージの中身が
差し変わっただけで、隔離の仕組みには影響しない。

**エッジキャッシュのTTL。** Worker 側で Cloudflare の Cache API を使い1時間（3600秒）
キャッシュする。投稿HTMLは一度置いたら書き換わらない前提なので基本的に問題ないが、
通報対応で作品を非表示にした場合、最大1時間は古いキャッシュから配信され続けるリスクがある。
長くすれば帯域節約になり、短くすれば取り下げの反映が早くなるトレードオフとして、
初期値は1時間とした。緊急性の高い削除要請が来た場合は手動でCloudflare側のキャッシュパージも行う。

**Supabaseプロジェクトの自動一時停止について。** Supabaseの無料プロジェクトは
1週間アクセスがないと自動的に一時停止（pause）される。本サービスは既にサムネ生成・
ベイズ平均再計算・古いログ削除のために毎日 GitHub Actions のバッチがSupabaseへ
アクセスする設計になっているため（6章参照）、追加の対策なしにこの問題を回避できる。

### 1-2. なぜヘッダでの sandbox が必須か

iframe の `sandbox="allow-scripts"`（`allow-same-origin` なし）を付けると、
その文書は **opaque origin**（`Origin: null`）になり、Cookie も localStorage も
同一オリジンの他ファイルも一切触れなくなる。ここまでは既知の通り。

問題は、Supabase Storage の公開URLを**直接ブラウザで開かれた場合**。
このときは iframe ではないので `sandbox` 属性が存在せず、
その文書は「配信ドメインの正規のオリジン」として動く。すると：

- 同じ配信ドメインに置かれた**他人の作品のストレージを読める**
- 配信ドメイン上で動く**フィッシングページ**として成立してしまう

`Content-Security-Policy: sandbox allow-scripts` をレスポンスヘッダで付けると、
直接アクセスでも opaque origin が強制される。これで上の2つが同時に塞がる。
MDN の記述上、`allow-top-navigation` 系のトークンだけが単独文書で無意味になるだけで、
**オリジンを opaque にする効果は単独文書でも働く**。

shim パターン（作品ごとに別サブドメインを割り当て、postMessage で流し込む）は
「作品どうしを完全に分離する」ためのもの。ヘッダ sandbox を付けた時点で
各文書は互いに一意の opaque origin になるため、初期規模では過剰。

### 1-3. 配信ヘッダ（確定形）

Supabase Storage の前に Cloudflare Workers を1枚挟んで、以下を強制する。
ストレージ側のオブジェクトメタデータ任せにしない（付け忘れが致命傷になるため）。

```
Content-Type: text/html; charset=utf-8
X-Content-Type-Options: nosniff
Content-Security-Policy:
  sandbox allow-scripts allow-pointer-lock;
  default-src 'none';
  script-src 'unsafe-inline' 'unsafe-eval' blob:;
  style-src 'unsafe-inline';
  img-src data: blob:;
  media-src data: blob:;
  font-src data:;
  connect-src 'none';
  form-action 'none';
  base-uri 'none';
  frame-ancestors https://<本体ドメイン>;
  webrtc 'block'
Cross-Origin-Resource-Policy: same-site
Cross-Origin-Opener-Policy: same-origin
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(),
  usb=(), serial=(), midi=(), display-capture=(), idle-detection=()
```

各行の意図：

| 指定 | 目的 |
|---|---|
| `sandbox allow-scripts allow-pointer-lock` | opaque origin を強制。pointer-lock はFPS系のために開ける |
| `default-src 'none'` | 明示的に許したもの以外すべて拒否 |
| `script-src 'unsafe-inline' 'unsafe-eval'` | 投稿HTMLはインラインスクリプトが前提。eval はエンジン製作品のために許す |
| `img-src data: blob:` | 外部画像を不可にし、1ファイル完結を強制 |
| `connect-src 'none'` | fetch / XHR / WebSocket / EventSource / sendBeacon をまとめて封じる |
| `form-action 'none'` | 偽ログインフォームからの送信を封じる |
| `frame-ancestors https://<本体ドメイン>` | 他人のサイトから作品を埋め込ませない |
| `webrtc 'block'` | 後述のWebRTC経路への蓋（部分的） |
| `Referrer-Policy: no-referrer` | 作品側にユーザーの閲覧元を渡さない |
| `Permissions-Policy` | カメラ・マイク・位置情報などを機能単位で殺す |

**`allow-modals` は入れない。** alert / confirm を連打されると閉じるまで操作不能になる。

### 1-4. iframe 側

```html
<iframe
  src="https://<配信ドメイン>/w/<nanoid>.html"
  sandbox="allow-scripts allow-pointer-lock"
  referrerpolicy="no-referrer"
  allow="camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'self'"
  loading="lazy"></iframe>
```

- `allow-same-origin` は絶対に付けない
- sandbox は属性とヘッダの両方で指定する。実効は**積集合**になるので二重に書いて損はない
- 一覧に戻ったら **iframe を DOM から破棄**する（`src=""` ではなく `remove()`）。
  裏で回り続けると端末が発熱する

### 1-5. 残存リスク（認識した上で受け入れる）

**WebRTC は `connect-src` の管轄外。**
`RTCPeerConnection` + DataChannel は CSP の connect-src をすり抜けることが知られており、
実際にこれを使って CSP を回避する情報窃取が観測されている。
後付けの `webrtc 'block'` ディレクティブがあるが Chromium系のみで、Firefox は未実装。

現実的な評価：opaque origin なので**盗めるデータがそもそもほとんどない**
（Cookie もストレージも読めない、親DOMにも触れない）。
漏れうるのは「作品内でユーザーが入力した文字列」程度。
外部通信を申請制で開放する段階になったら、ここが最初の検討事項になる。

**CPU の消費は止められない。**
無限ループ、暗号マイニング、大量描画。サーバー負荷にはならないが端末が焼ける。
ファイルサイズ上限では防げない。対策は通報と、離脱時の iframe 破棄のみ。

**`'unsafe-inline'` / `'unsafe-eval'` を許す以上、投稿コードは任意のJSを実行できる。**
封じているのは「外に出す経路」だけ。これは仕様であって穴ではない。

---

## 2. 星評価（匿名・全票同一重み）

**方針：セキュリティ以外の不正は許容する。** 票の水増しや自作自演を検知・排除する仕組みは作らない。
実装が重くなる上に、攻撃側が常に一手先を行く勝負になるため。

### 2-1. 識別

```
visitor_id : 初回訪問時に発行する nanoid。localStorage と Cookie の両方に置く
```

- `(work_id, visitor_id)` にユニーク制約 → 1作品1票
- これは不正対策ではなく**UX**。誤操作による二重投票を防ぎ、付けた星を後から変更できるようにするため
- localStorage を消せば再投票できる。**それは許容する**
- Turnstile、IPベースの制限、異常検知バッチはいずれも実装しない

### 2-2. 重み付けはしない

ログイン済みの票も匿名の票も、作品を開いていない人の票も、すべて **w = 1.0**。
実効票数という概念を持たず、素の票数をそのまま使う。

### 2-3. ベイズ平均は入れる（不正対策ではなく順位の質のため）

票の重み付けをしない分、「1票だけ満点の作品が首位に来る」問題への防御はこれ1本になる。

```
R = その作品の平均点
v = その作品の票数
m = 基準票数
C = サイト全体の平均点

スコア = (v / (v + m)) × R + (m / (v + m)) × C
```

- `m` = 全作品の票数の**中央値**（最低3、上限20でクランプ）を日次バッチで更新
- `C` = サイト全体の平均点。実測をそのまま使う
- どちらもサムネ生成の GitHub Actions に相乗りさせる（追加コストゼロ）

並べ替えの「評価数」は素の票数をそのまま表示する。

### 2-4. アクセス数

`(work_id, visitor_id, 日付)` にユニーク制約。同一 visitor_id は1日1カウント。
これも不正対策ではなく、リロード連打で数字が壊れないようにするためのもの。

---

## 3. コメント（匿名・事前審査なし）

### 3-1. 投稿

- ログイン不要。名前欄は任意（未入力なら「ななし」等）
- 文字数上限 500字
- 事前審査なし。投稿即公開
- スパムフィルタ、レート制限、Turnstile は**入れない**

ただし `comments` テーブルに `is_hidden`（bool）と `hidden_reason` を最初から持たせる。
スパムが実害になった時点で、フィルタを1本足せば済む状態にしておく。
**カラムは今作る、判定は今作らない。**

### 3-2. 表示と削除（ここは作る）

不正の話ではなく、権利侵害と誹謗中傷への対応なので、これは最初から必要。

- 投稿者本人は削除できる（投稿時に発行したトークンを localStorage に保持）。編集は不可
- **作者は自分の作品に付いたコメントを非表示にできる**
  → 運営コストを分散する最重要の仕組み。全部を運営が見る設計は破綻する
- 通報ボタン。通報が3件で自動的に非表示になり、運営確認待ちになる
- 運営はあらゆるコメントを非表示にできる

### 3-3. 発信者情報のログ（匿名開放の代償）

匿名コメントを許すということは、**発信者情報開示請求の窓口になる**ということ。
ここは「不正を許す」方針の対象外。法的な話なので削れない。

誹謗中傷などで開示請求が来たとき、記録を持っていないと開示に応じられず、
「保有していない」と回答することになる。運営者として苦しい立場になる。

```
comments テーブル:
  ip_address   TEXT           -- 平文で保存
  user_agent   TEXT
  created_at   TIMESTAMPTZ
```

- **保存期間 6ヶ月**。以降は日次バッチで自動削除
- 利用規約とプライバシーポリシーに**明記する**（書かずに保存するのが最悪）
- 参照するのは、法令に基づく開示請求・裁判所の命令があった場合のみ

法的な整理：
プロバイダ責任制限法（現・情報流通プラットフォーム対処法）の枠組み上、
**ログの保存自体は法的義務ではない**。保有している場合に開示義務が生じる。
情プラ法の重い義務（対応体制の公表、判断期間の遵守など）は
「大規模特定電気通信役務提供者」として総務大臣に指定された事業者が対象で、
個人が始める規模のサイトは対象外。
ただし**通報の受付窓口を置くこと**は、規模に関わらず実務上必須。

---

## 4. 権限とアップロード

- **Supabase Storage への直接アップロードはさせない。** Supabase Edge Function 経由で署名URLを発行する。
  クライアント直アップだとサイズ上限もMIMEチェックも迂回される
- 作品IDは **nanoid**。連番にすると下書き・非公開を先読みされる
- RLS：
  - `works` — select は匿名可。insert / update / delete は `auth.uid() = author_id`
  - `ratings` — insert/update は匿名可（`upsert_rating` RPC経由）。全票同一重み。Turnstileやレート制限は入れない
  - `comments` — 直接INSERTは禁止（`with check (false)`）。投稿は必ず `submit-comment` Edge Function を通す。
    理由はスパム対策ではなく、ip_address/user_agentをクライアントの自己申告にせず実測するため（3-3節）
- **削除は物理削除にしない。** `status`（published / hidden / removed）で落とす。
  権利者から要請が来たときに即座に止められ、記録も残る

---

## 参考

- Securely hosting user data in modern web applications — web.dev
  https://web.dev/articles/securely-hosting-user-data
- Content-Security-Policy: sandbox — MDN
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox
- WebRTC bypass CSP connect-src policies — w3c/webrtc-nv-use-cases #35
  https://github.com/w3c/webrtc-nv-use-cases/issues/35
- Novel WebRTC skimmer bypasses security controls — Sansec
  https://sansec.io/research/webrtc-skimmer
- 情報流通プラットフォーム対処法 — 総務省
  https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/ihoyugai.html
