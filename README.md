# arasuji.js

<img src="public/img/logo-wordmark.svg" alt="arasuji.js のロゴ" width="320">

長文ページを中断したあとで再開するときに、「前回のあらすじ」を音声で聞けるようにするライブラリです。音声で読む人（スクリーンリーダーの利用者）向けに作っています。

デモ: <https://arasuji.takosu.me/>

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
<script src="/v1/arasuji.js" defer data-container="main" data-heading="h2"></script>

<!-- 教材風のページ（節を <section> で囲まない平らな構造） -->
<script src="./arasuji-data.js" defer></script>
<script src="/v1/arasuji.js" defer data-preset="lesson" data-shortcuts="on"></script>
```

`arasuji-data.js`（要約データ）がなくても動きます。そのときのあらすじは、要点を省いた文（どこまで・続き・残り）になります。

組み込むと、h1 の直後に「前回のあらすじ」欄が、各節の末尾に「次の節へ」ボタンが入ります。

URL の `v1` は版です。互換性のない変更は `/v2/` に入れるので、`/v1/` を指定しておけば、変更でページが壊れることはありません。版なしの `/arasuji.js` は `/v1/arasuji.js` に転送します。

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
| `data-optin` | なし | ボタンのセレクタ。そのボタンでオンにしたときだけ動く（下の「使う人だけオンにする」） |
| `data-caption` | `on` | `off` で字幕と光らせる演出を止める。どちらもデモ用なので、デモ以外では `off` を勧めます |
| `data-css-layer` | `off` | `on` で差し込む CSS を `@layer arasuji` に入れ、サイトの CSS が詳細度によらず勝つようにする |

ほかの設定、公開 API（`window.Arasuji`）、イベント（`arasuji:ready` など）は [docs/spec.md](docs/spec.md) の 4章と8章を見てください。自前の UI を作る例は `public/custom/` にあります。

### 色を変える

既定の UI の色は CSS 変数で変えられます。ライブラリのクラス名を上書きする必要はありません。既定値は `light-dark()` なので、ページが `color-scheme: light dark` ならダークモードにも合わせます。

```css
:root {
  --arasuji-accent: #8250df;     /* 枠・見出し・ボタン */
  --arasuji-bg: #fff;            /* 背景 */
  --arasuji-text: #222;          /* 文字 */
  --arasuji-muted: #555;         /* 薄い文字 */
  --arasuji-border: #ddd;        /* 枠線 */
  --arasuji-caption-bg: #f4f6f8; /* 字幕の背景 */
  --arasuji-focus: #8250df;      /* フォーカスの輪 */
  --arasuji-on-accent: #fff;     /* 「続きから読む」の文字 */
}
```

### 使う人だけオンにする

ボタンを1つ置き、`data-optin` にそのセレクタを書きます。ライブラリがボタンの `aria-pressed` を管理し、選んだ状態を保存して、オンのときだけ動きます。

```html
<button id="arasuji-toggle" type="button">「前回のあらすじ」を使う</button>
<script src="/v1/arasuji.js" defer data-optin="#arasuji-toggle" data-caption="off"></script>
```

### 止める・動けなかったことを知る

- `Arasuji.destroy()` で、差し込んだ要素・リスナー・タイマーをすべて外します。進捗は残ります。止めたあとにもう一度読み込んでも、二重には動きません
- 節の見出しが見つからないときなど、動けなかったときは `arasuji:unavailable` イベントを出します（`detail.reason` は `no-container`・`no-headings` など）

```html
<script>
  // arasuji.js（defer）より前に登録する
  document.addEventListener('arasuji:unavailable', () => {
    document.getElementById('arasuji-toggle').hidden = true;
  });
</script>
```

### サイトが対応していなくても使う

利用者が自分のブラウザで差し込む方法も2つ用意しています。サイト運営者の作業はいりません。

- **ブックマークレット**：`public/bookmarklet.html` を開き、リンクをブックマークに登録します。読みたいページでそのブックマークを開くと UI が入ります。もう一度押すと、あらすじを読み上げます。外部の script を止めている（CSP）サイトでは使えません
- **Chrome 拡張機能**（`extension/`）：CSP のあるサイトでも使えます。読み込み方は「開発」を見てください
  - ポップアップの「このページで使う」か Alt+Shift+A で、いまのタブに入れます
  - 「このサイトでは開いたときに自動で使う」をオンにすると、そのサイトを開くたびに入ります
  - 本文が iframe の中にあるサイトでは、本文のある iframe を選んでその中に入れます

サイトごとの設定（コンテナや見出しのセレクタ）は `public/sites.js` にあります。一覧にないサイトでは、`main` → `[role="main"]` → `article` の順でコンテナを探し、`h2` を節の見出しにします。拡張機能のポップアップでは、サイトごとにセレクタを上書きできます。

## 開発

pnpm を使います。依存は `serve`（デモ配信）と、テスト用の `vitest`・`jsdom` だけで、ビルドはありません。

```sh
pnpm install
pnpm dev          # http://localhost:8787 でデモを開く
pnpm test         # テスト（Vitest。arasuji.js は jsdom で動かす）
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

ほかのサイト（ブログなど）でも、ビルドした HTML から作れます。そのサイトに `arasuji.config.json` を置き、`--config` で指定します。`input` と `output` は設定ファイルからの相対パスで、`recursive: true` なら下のディレクトリもたどります（`posts/foo/index.html` のページ ID は `foo`）。

```jsonc
{
  "ai": { "provider": "anthropic", "model": "claude-opus-5-5" },
  "sites": [
    { "input": "dist/posts", "output": "dist/arasuji-data.js", "recursive": true, "container": "article", "heading": "h2" }
  ]
}
```

```sh
node path/to/arasuji-js/scripts/generate.mjs --config arasuji.config.json
```

### 拡張機能を読み込む

拡張機能は自分のフォルダの中のファイルしか読めないので、`public/v1/arasuji.js` と `public/sites.js` を `extension/` に写してから読み込みます。直すのは `public/` のほうだけにしてください（写したファイルはリポジトリに入れません）。

```sh
pnpm extension
```

そのあと、chrome://extensions でデベロッパーモードをオンにし、「パッケージ化されていない拡張機能を読み込む」から `extension/` を選びます。

### プリセットを変えるとき

プリセット（`lesson`）の値は `public/v1/arasuji.js` と `public/sites.js` の両方にあります。`arasuji.js` はページに単独で置かれるので、1か所にまとめられないためです。片方を変えたら、もう片方も同じ値にしてください。`pnpm check` で一致を確かめられます（`pnpm extension` でも確かめます）。

### デプロイする

`public/` を Cloudflare Workers の静的アセットとして配信します。初回は `pnpm exec wrangler login` でログインしてください。

```sh
pnpm run deploy   # arasuji.<アカウント>.workers.dev に上げる
```

独自ドメインで配信するときは、`wrangler.jsonc` を写して `wrangler.local.jsonc` を作り、`routes` を足します。このファイルはリポジトリに入れません。

```jsonc
{
  // wrangler.jsonc と同じ内容に、次の2つを足す
  "workers_dev": false,
  "routes": [
    { "pattern": "arasuji.example.com", "custom_domain": true }
  ]
}
```

```sh
pnpm run deploy:local
```

## ファイル構成

```
public/
  v1/arasuji.js      本体（コア・読み上げ・既定 UI）。互換性のない変更は v2/ に入れる
  _redirects         版なしの /arasuji.js を /v1/arasuji.js に送る
  sites.js           ブックマークレットと拡張機能が使う、サイトごとの設定
  bookmarklet.js     ブックマークレットから読み込まれる
  bookmarklet.html   ブックマークレットの登録ページ
  lesson/ docs/ custom/ デモ
extension/           Chrome 拡張機能（Manifest V3）
scripts/
  generate.mjs       要約データを作る
  copy-extension.mjs public/ のファイルを extension/ に写す
  check-presets.mjs  プリセットが同じ値か確かめる
test/                テスト（test/arasuji/ が本体のテスト）
docs/spec.md         仕様
```

## 制約

- 静的な長文ページが対象です。SPA のようにページ遷移で DOM が入れ替わるサイトでは、2ページ目以降の節が合いません
- 文言は日本語だけです
- 進捗は端末ごとに保存します。ほかの端末とは共有しません
- 拡張機能は Chrome だけで、ストアには出していません

ほかの制約は [docs/spec.md](docs/spec.md) の12章にあります。

## ライセンス

[MIT License](LICENSE)
