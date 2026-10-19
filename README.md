# arasuji.js

長文ページを中断したあとで再開するときに、「前回のあらすじ」を音声で聞けるようにするライブラリです。音声で学ぶ人（スクリーンリーダーの利用者）向けに作っています。

ページに script を足すだけで、次のことができるようになります。

- 前回どこまで読んだか、続きはどこか、ここまでの要点、残りの節数を、aria-live で読み上げる
- 続きの節の見出しへフォーカスを移す
- ページ全体の節の並びと、既読・未読を読み上げる

進捗は端末の localStorage に保存します。要約と要点は生成スクリプトで事前に作っておき、人が確認してから使います。

詳しい仕様は [docs/spec.md](docs/spec.md) にあります。

## 使い方

### ページに組み込む

ページの末尾に2行足します。既存の HTML にクラスや属性を足す必要はありません。

```html
<!-- 汎用（<main> の中の h2 を節の見出しにする） -->
<script src="./arasuji-data.js" defer></script>
<script src="/arasuji.js" defer data-container="main" data-heading="h2"></script>

<!-- 教材風のページ（節を <section> で囲まない平らな構造） -->
<script src="./arasuji-data.js" defer></script>
<script src="/arasuji.js" defer data-preset="lesson" data-shortcuts="on"></script>
```

`arasuji-data.js`（要約データ）がなくても動きます。そのときのあらすじは、要点を省いた文（どこまで・続き・残り）になります。

組み込むと、h1 の直後に「前回のあらすじ」欄が、各節の末尾に「次の節へ」ボタンが入ります。

### 主な設定（data 属性）

| 属性 | 既定値 | 意味 |
| --- | --- | --- |
| `data-container` | `main` | 本文のコンテナのセレクタ |
| `data-heading` | `h2` | 節の見出しのセレクタ |
| `data-end` | なし | 本文の終わりの目印のセレクタ。この中の見出しは節にしない |
| `data-preset` | なし | `lesson` で教材風のページ用の値をまとめて設定する |
| `data-page-id` | URL の最後の部分 | 進捗と要約を引く ID |
| `data-namespace` | `default` | localStorage のキーの名前空間 |
| `data-shortcuts` | `off` | `on` で Alt+Shift+R（あらすじ）・J（続きへ）・O（全体像）を使えるようにする |
| `data-autoplay` | `off` | `on` で、開いたときにあらすじを自動で読み上げる |
| `data-ui` | `on` | `off` で既定の UI を入れない（自前の UI を作るとき） |

ほかの設定、公開 API（`window.Arasuji`）、イベント（`arasuji:ready` など）は [docs/spec.md](docs/spec.md) の 4章と8章を見てください。自前の UI を作る例は `public/custom/` にあります。

### サイトが対応していなくても使う

利用者が自分のブラウザで差し込む方法も2つ用意しています。サイト運営者の作業はいりません。

- **ブックマークレット**：`public/bookmarklet.html` を開き、リンクをブックマークに登録します。読みたいページでそのブックマークを開くと UI が入ります。もう一度押すと、あらすじを読み上げます。外部の script を止めている（CSP）サイトでは使えません
- **Chrome 拡張機能**（`extension/`）：CSP のあるサイトでも使えます。読み込み方は「開発」を見てください
  - ポップアップの「このページで使う」か Alt+Shift+A で、いまのタブに入れます
  - 「このサイトでは開いたときに自動で使う」をオンにすると、そのサイトを開くたびに入ります
  - 本文が iframe の中にあるサイトでは、本文のある iframe を選んでその中に入れます

サイトごとの設定（コンテナや見出しのセレクタ）は `public/sites.js` にあります。一覧にないサイトでは、`main` → `[role="main"]` → `article` の順でコンテナを探し、`h2` を節の見出しにします。拡張機能のポップアップでは、サイトごとにセレクタを上書きできます。

## 開発

pnpm を使います。依存は `serve` だけで、ビルドはありません。

```sh
pnpm install
pnpm dev          # http://localhost:8787 でデモを開く
```

デモは `public/` にあります。

- `public/lesson/`：教材風のページ（節を `<section>` で囲まない平らな構造）
- `public/docs/`：ドキュメント風のページ（節ごとに `<section>` で囲む構造）
- `public/custom/`：`data-ui="off"` で自前の UI を作る例

`data-demo="on"` のページでは、URL に `?demo=3days`（2節まで読んで3日たった状態）、`?demo=today`、`?demo=reset` を付けると、進捗の状態を作れます。一覧ページ（`public/index.html`）にリンクがあります。

### 要約データを作る

`arasuji.config.json` に書いたページから、節ごとの要約と「ここまでの要点」を AI で作り、`arasuji-data.js` に書き出します。出力は人が確認してから使ってください。

使う AI は `arasuji.config.json` の `ai` で選びます。認証情報は環境変数で渡します。

| `provider` | 対象 | 環境変数 |
| --- | --- | --- |
| `workers-ai` | Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` |
| `openai` | OpenAI と、同じ形の API（Ollama・LM Studio・OpenRouter・Gemini など） | `OPENAI_API_KEY`（`apiKeyEnv` で変えられる。ローカルの Ollama などはなくてよい） |
| `anthropic` | Anthropic（Claude） | `ANTHROPIC_API_KEY`（`apiKeyEnv` で変えられる） |

```jsonc
// Workers AI
"ai": { "provider": "workers-ai", "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }

// ローカルの Ollama（OpenAI と同じ形の API なので openai を使い、baseURL を変える）
"ai": { "provider": "openai", "model": "qwen3:8b", "baseURL": "http://localhost:11434/v1" }

// Anthropic
"ai": { "provider": "anthropic", "model": "claude-opus-5-5" }
```

```sh
export CLOUDFLARE_ACCOUNT_ID=...   # provider に合わせて渡す
export CLOUDFLARE_API_TOKEN=...
pnpm generate

pnpm generate:dry  # API を呼ばず、本文の1文目で仮のデータを作る
```

### 拡張機能を読み込む

拡張機能は自分のフォルダの中のファイルしか読めないので、`public/` の `arasuji.js` と `sites.js` を `extension/` に写してから読み込みます。直すのは `public/` のほうだけにしてください（写したファイルはリポジトリに入れません）。

```sh
pnpm extension
```

そのあと、chrome://extensions でデベロッパーモードをオンにし、「パッケージ化されていない拡張機能を読み込む」から `extension/` を選びます。

### プリセットを変えるとき

プリセット（`lesson`）の値は `public/arasuji.js` と `public/sites.js` の両方にあります。`arasuji.js` はページに単独で置かれるので、1か所にまとめられないためです。片方を変えたら、もう片方も同じ値にしてください。`pnpm check` で一致を確かめられます（`pnpm extension` でも確かめます）。

## ファイル構成

```
public/
  arasuji.js         本体（コア・読み上げ・既定 UI）
  sites.js           ブックマークレットと拡張機能が使う、サイトごとの設定
  bookmarklet.js     ブックマークレットから読み込まれる
  bookmarklet.html   ブックマークレットの登録ページ
  lesson/ docs/ custom/ デモ
extension/           Chrome 拡張機能（Manifest V3）
scripts/
  generate.mjs       要約データを作る
  copy-extension.mjs public/ のファイルを extension/ に写す
  check-presets.mjs  プリセットが同じ値か確かめる
docs/spec.md         仕様
```

## 制約

- 静的な長文ページが対象です。SPA のようにページ遷移で DOM が入れ替わるサイトでは、2ページ目以降の節が合いません
- 文言は日本語だけです
- 進捗は端末ごとに保存します。ほかの端末とは共有しません
- 拡張機能は Chrome だけで、ストアには出していません

ほかの制約は [docs/spec.md](docs/spec.md) の12章にあります。
