# arasuji.js 仕様

音声で学ぶ人が、中断した長文ページを再開するときに「前回のあらすじ」を聞けるようにするライブラリ。

- 出典：`arasuji-build-guide.md`（当日の作り方ガイド）から、作るものの仕様だけを抜き出してまとめたもの。作業計画・準備・デモ台本はガイドを参照する
- 名前は仮。`arasuji` を一括置換すれば変えられる（ファイル名・グローバル変数・localStorage のキー・CSS の接頭辞・イベント名）

## 1. 概要

### 1.1 目的

ページに script を足すだけで、次のことができるようにする。

- 前回どこまで読んだか、続きはどこか、ここまでの要点、残りの節数を音声（aria-live）で聞ける
- 続きの節の見出しへフォーカスを移せる
- ページ全体の節の並びと既読・未読を聞ける

### 1.2 対象と対象外

| 対象 | 対象外 |
| --- | --- |
| 静的な長文ページ（教材・ドキュメント・記事） | SPA のページ遷移で DOM が入れ替わるサイト |
| セレクタで節の見出しを指定できるページ | 見出し構造の自動推定 |
| 日本語の文言 | 多言語対応（文言は日本語固定） |
| 端末ごとの進捗（localStorage） | サーバーでの進捗管理（将来は①の保存先を差し替える） |

### 1.3 方針

| 項目 | 方針 |
| --- | --- |
| 形 | ページに script を足すだけで動く。既存の要素は変えず、足すだけにする（例外は `resume()` の移り先（見出しと導入部分の先頭）に付ける `tabindex="-1"`） |
| 責務 | コア・読み上げ・表示の3層に分ける。コアと読み上げが本体で、表示は差し替えられる既定 UI |
| サイト固有の部分 | script の data 属性で指定する（コンテナ・見出し・終わりの目印・テーマ色）。教材風のページ用はプリセットにする |
| 配信 | 静的ファイルだけ（Cloudflare Pages） |
| 要約 | 生成スクリプトで事前に全位置ぶん作り、JS ファイルに書き出す（AI のプロバイダーは設定で選ぶ：Workers AI・OpenAI 互換 API・Anthropic）。人が出力を確認してから使う |
| 進捗 | localStorage |

## 2. 構成と技術的な制約

### 2.1 ファイル構成

```
public/
  index.html             デモ一覧＋デモ用リンク（?demo=3days など）
  arasuji.js             本体（①コア ②読み上げ ③既定 UI）
  lesson/                教材風のデモ
    style.css
    arasuji-data.js      生成物
    py-func.html         モック教材（4節）
    py-list.html         モック教材（4節）※任意
  docs/                  別構造のデモ（汎用性を見せる用）
    style.css
    arasuji-data.js      生成物
    getting-started.html <main> と <section> で組んだドキュメント風ページ（3〜4節）
  custom/                ※任意：自前 UI の例
    index.html           data-ui="off" ＋ 自作の操作バー
  sites.js               ブックマークレットと拡張機能が使う、サイトごとの設定（4.4 の利用者向け）
  bookmarklet.js         ブックマークレットから読み込む。sites.js で設定を決めて arasuji.js を読む
  bookmarklet.html       ブックマークレットの登録ページ
extension/               Chrome 拡張機能（Manifest V3）
  manifest.json
  background.js          タブに sites.js と arasuji.js を差し込む
  popup.html / popup.js  「このページで使う」ボタンとサイトごとの設定
  auto.js                「自動で使う」にしたサイトの各 frame で動き、節があれば差し込みを頼む
  arasuji.js・sites.js   pnpm extension で public/ から写す（リポジトリに入れない）
scripts/
  generate.mjs           ページ → arasuji-data.js（AI で要約）
  copy-extension.mjs     public/ の arasuji.js と sites.js を extension/ に写す
  check-presets.mjs      arasuji.js と sites.js のプリセットが同じ値か確かめる（pnpm extension でも動く）
test/                    pnpm test（Vitest）
  arasuji/               arasuji.js を jsdom のページに読み込み、公開 API とイベントを通して確かめる
  generate.test.mjs      generate.mjs（AI は呼ばず、fetch を差し替える）
  sites.test.mjs         sites.js
  presets.test.mjs       check-presets.mjs を動かす
arasuji.config.json      generate.mjs 用のサイト設定
package.json
```

### 2.2 制約

- パッケージマネージャーは pnpm
- 依存は devDependencies の `serve`（デモ配信）と、テスト用の `vitest`・`jsdom` だけ。ビルドしない
- `arasuji.js` のテストは公開 API・イベント・DOM だけを見る（内部の関数を取り出すために本体を書き換えない）
- `arasuji.js` は素の JavaScript（ES2020）、モジュールにしない1ファイル
- `generate.mjs` は Node.js 標準の `fetch` と `fs` だけで書く（wrangler・HTML パーサーは入れない）
- デモページの HTML に arasuji のためのクラスや属性を足さない。足してよいのは末尾の script 2行だけ（自前 UI の例を除く）
- 実在の教材・記事の本文をコピーしない
- AI の認証情報は環境変数で渡し、リポジトリに入れない（10.3）

### 2.3 package.json

```json
{
  "name": "arasuji",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "serve public -l 8787",
    "generate": "node scripts/generate.mjs",
    "generate:dry": "node scripts/generate.mjs --no-ai",
    "extension": "node scripts/check-presets.mjs && node scripts/copy-extension.mjs",
    "check": "node scripts/check-presets.mjs",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": { "jsdom": "^30.1.2", "serve": "^14", "vitest": "^5.0.4" }
}
```

## 3. アーキテクチャ（3層）

| 層 | 責務 | DOM への関わり | `data-ui="off"` のとき |
| --- | --- | --- | --- |
| ① コア | 設定の解決、節の検出、進捗の記録と保存、あらすじ文・全体像の文の組み立て、要約データの参照、状態変化の通知 | 読むだけ（focusin の監視は行う） | 動く |
| ② 読み上げ・フォーカス | aria-live への通知、「続きへ」のフォーカス移動、ショートカット、自動読み上げ | ライブ通知領域を1つ置く。`resume()` の移り先（見出しと導入部分の先頭）に `tabindex="-1"` を付ける | 動く |
| ③ 既定 UI | あらすじ欄、ボタン、「次の節へ」ボタン、字幕、光らせる演出、CSS | 要素と `<style>` を差し込む | 何も差し込まない |

- アクセシビリティの品質（aria-live の置き方、一度空にしてから入れる、フォーカスは「続きへ」のときだけ動かす）は②が持つ。利用側に任せない
- ③は `window.Arasuji` の公開 API とイベントだけを使う。内部の変数に触らない。これにより自前 UI でも同じことができると保証する
- 「次の節へ」ボタンは③に属するが、進捗記録の主なきっかけでもある。ボタンは `Arasuji.markRead(n)` を呼ぶだけにする
- 1ファイルのまま、関数で分ける

```js
(() => {
  const script = document.currentScript;   // defer でも実行中は値が入っている
  const source = script ? script.dataset : window.ARASUJI_CONFIG;  // 拡張では script 要素を通らない（4.6）
  if (!source) return;
  const cfg = resolveConfig(source);

  function createCore(cfg) { … }            // ①
  function createVoice(core, cfg) { … }     // ②
  function createDefaultUI(api, cfg) { … }  // ③ 公開 API とイベントだけを使う

  if (document.getElementById('arasuji-live')) return;  // すでに動いていれば何もしない（4.6）
  const core = createCore(cfg);
  if (!core) return;                        // コンテナや見出しがなければ何もしない
  const voice = createVoice(core, cfg);
  window.Arasuji = { ...core.api, ...voice.api, ready: … };
  if (cfg.ui !== 'off') createDefaultUI(window.Arasuji, cfg);
  emit('arasuji:ready', core.api.getState());
})();
```

- `document.currentScript` はイベントハンドラや API の中では `null` になるので、最初に変数へ取っておく
- コアが `null` のとき（コンテナや見出しがない）は、`window.Arasuji` を定義せず、`arasuji:ready` も出さない

## 4. 組み込み方

### 4.1 全部入り（既定）

ページの末尾に2行足す。

```html
<!-- 教材風 -->
<script src="./arasuji-data.js" defer></script>
<script src="../arasuji.js" defer data-preset="lesson" data-shortcuts="on"></script>

<!-- 汎用 -->
<script src="./arasuji-data.js" defer></script>
<script src="../arasuji.js" defer data-container="main" data-heading="h2"></script>
```

- デモページ（11.）では、どちらにも `data-demo="on"` を足す（`?demo=` を受け付けるため）

### 4.2 表示は自前（`data-ui="off"`）

```html
<script src="./arasuji-data.js" defer></script>
<script src="../arasuji.js" defer data-container="main" data-heading="h2" data-ui="off"></script>
<script>
  document.addEventListener('arasuji:ready', e => {
    render(e.detail);                                   // 最初の描画
    recapButton.onclick = () => Arasuji.recap();
    nextButton.onclick  = () => {
      const { next } = Arasuji.getState();
      if (!next) return Arasuji.announce('このページは最後まで読み終えています。');
      Arasuji.markRead(next);
      if (Arasuji.getState().next) Arasuji.resume();      // 読み終えたらフォーカスは動かさない（7.2）
      else Arasuji.announce('このページを読み終えました。');
    };
    document.addEventListener('arasuji:change', e => render(e.detail));
    document.addEventListener('arasuji:announce', e => showCaption(e.detail.text));
  });
</script>
```

- インラインの script には `defer` が効かない。その場で実行されるので、`arasuji.js`（defer）より先に `arasuji:ready` のリスナーを登録できる

### 4.3 data 属性

| 属性 | 既定値 | 層 | 意味 |
| --- | --- | --- | --- |
| `data-preset` | なし | ① | `lesson` を指定すると下のプリセットの値をまとめて設定する。個別の属性が優先 |
| `data-container` | `main` | ① | 本文のコンテナのセレクタ |
| `data-heading` | `h2` | ① | 節の見出しのセレクタ（コンテナを基点に `querySelectorAll`） |
| `data-end` | なし | ① | 本文の終わりの目印のセレクタ。この中の見出しは節にしない |
| `data-page-id` | URL の最後の部分 | ① | 進捗と要約を引く ID |
| `data-namespace` | `default` | ① | localStorage のキーの名前空間 |
| `data-demo` | `off` | ① | `on` で `?demo=` パラメータを受け付ける |
| `data-shortcuts` | `off` | ② | `on` で Alt+Shift+R/J/O を有効にする（他サイトのキーとぶつかるので既定はオフ） |
| `data-autoplay` | `off` | ② | `on` で読み込みの1.5秒後にあらすじを読む。利用者が変えた値（localStorage）が優先 |
| `data-ui` | `on` | ③ | `off` で既定 UI を差し込まない |

### 4.4 プリセット `lesson`

| 項目 | 値 |
| --- | --- |
| container | `.markdown-section` |
| heading | `:scope > h2` |
| end | `:scope > .share-button-wrapper` |
| アクセント色 | `var(--material-color-main, #2a7ab0)` |

### 4.5 CSS 変数

- `--arasuji-accent`：既定 UI のアクセント色。ページ側から上書きできる（③だけが使う）

### 4.6 利用者が自分で入れる（ブックマークレット・拡張機能）

サイトが arasuji.js に対応していなくても、利用者が自分のブラウザで差し込めるようにする。サイト運営者の作業はいらない。

**arasuji.js の側で必要なこと**

- 設定は `<script>` の data 属性のほか、`window.ARASUJI_CONFIG` からも受け取る。`document.currentScript` が `null`（拡張機能の content script など、script 要素を通らずに動くとき）なら `ARASUJI_CONFIG` を使う。どちらもなければ何もしない
  - `ARASUJI_CONFIG` のキーは data 属性から `data-` を除いてキャメルケースにしたもの（`{ container, heading, end, pageId, namespace, shortcuts, autoplay, ui }`）。`on`／`off` の項目は `true`／`false` でもよい
- すでに動いているページ（ライブ通知領域 `#arasuji-live` がある）では、もう一度読み込まれても何もしない。ブックマークレットを2回押したとき、ページと拡張の両方が入れたときに、UI が二重にならないようにする
  - `window.Arasuji` ではなく DOM で確かめる。拡張機能はページとは別の JS 環境で動き、ページの `window.Arasuji` が見えないため

**サイトごとの設定（`public/sites.js`）**

- 設定済みのサイトを `{ name, match, config }` の一覧で持つ。`match` は URL の前方一致、`config` は `ARASUJI_CONFIG` と同じ形
- 一覧にないサイトでは、`main` → `[role="main"]` → `article` の順で、ページにある最初のものをコンテナにする。見出しは既定の `h2`
- ブックマークレットと拡張機能の両方が同じファイルを使う。拡張機能の service worker でも読むので、`window` ではなく `globalThis` に置く
- サイトの項目には、次のものも書ける
  - `pageId(url)`：URL からページ ID を作る関数。URL の最後の部分が教材によらず同じサイト（`/lessons/{番号}/content` のように最後が `content` で終わるサイトなど）で使う
  - `skip: true`：その URL の文書には入れない。本文のない外側のページや中間の iframe に使う
- `config` には `preset` も書ける。`sites.js` はプリセットの値を開いてから節を数える。プリセットの値は `arasuji.js` と `sites.js` の両方に置き（`arasuji.js` はページに単独で置かれるため）、`scripts/check-presets.mjs` で同じ値か確かめる

**本文が iframe の中にあるサイト**

教材サイトによっては、本文が外側のページの2段下の iframe に入っている（どれも同じオリジン）。外側のページと中間の iframe には本文がない。

- ブックマークレットと拡張機能は、外側のページと iframe を何段でもたどって、本文のある文書を選び、その文書の中に arasuji.js を入れる（ライブ通知領域・あらすじ欄・フォーカスの移り先も、その iframe の中に置く）
  - 選び方：設定済みのサイトで節があるもの → 外側のページ → 節がいちばん多い iframe。同じ条件なら外側に近いもの（外側のページからの段数で比べる）。`skip` の文書と節が0の文書は選ばない
    - 一覧にないサイトでは、外側のページに節があれば iframe には入れない。同じオリジンの広告・コメント欄・埋め込みの iframe の見出しのほうが多くても、そちらに入れないため（「自動で使う」が一覧にないサイトでは外側のページだけで動くのとも合わせる）
  - ブックマークレットは別オリジンの iframe の中に触れないので、同じオリジンの iframe だけをたどる。拡張機能は、権限のある frame だけを調べる
- iframe が同じオリジンなので、localStorage は外側のページと共有される

**ブックマークレット**

- ブックマークの中身は、`bookmarklet.js` を読み込む数行だけにする。設定や本体を直したとき、利用者が登録し直さなくて済むように
- `bookmarklet.js` は `sites.js` を読み、このページの設定を決めてから、その設定を data 属性に付けた `arasuji.js` を読み込む
- すでに動いているページでもう一度押すと、あらすじを読み上げる（`Arasuji.recap()`）。動いているのが iframe の中なら、その iframe の `Arasuji` を呼ぶ
  - 拡張機能が入れたもの（ページから `Arasuji` が見えない）しかなければ、`alert` で「すでに動いています」と知らせる
- script 要素は、入れる先の文書（iframe の中）に作る。そうするとその iframe の中で動く
- 読み込めなかったとき（CSP で外部の script を止めているサイトなど）と、節の見出しが見つからなかったときは `alert` で知らせる
- 登録ページ（`bookmarklet.html`）は、自分の URL から読み込み先を組み立てる。置き場所を変えても書き換えなくてよい

**拡張機能（`extension/`、Chrome・Manifest V3）**

- ポップアップの「このページで使う」か、ショートカット（Alt+Shift+A）で、いまのタブに `sites.js` と `arasuji.js` を差し込む。権限は `activeTab`・`scripting`・`storage` だけで、その操作をしたタブにしか触らない
  - まずタブのすべての frame で `sites.js` の `probe` を動かして節の数を調べ、`pick` で選んだ frame にだけ `arasuji.js` を入れる
  - `activeTab` で触れるのは、外側のページと同じオリジンの frame まで。別オリジンの iframe に本文があるサイトでは、「自動で使う」と同じくそのオリジンの権限が別にいる
  - どの frame も調べられなかったとき（権限がない・差し込みに失敗した）は、節がないときとは別に「本文を読めませんでした」と出す
- 拡張機能のスクリプトはページの CSP に止められないので、ブックマークレットが使えないサイトでも使える
- 進捗はページと同じ localStorage に入る（content script はページの localStorage を共有する）。ブックマークレットで記録した進捗も、同じキーなのでそのまま引き継がれる
- すでに動いているときの扱い
  - 拡張機能が入れたもの：あらすじを読み上げる
  - ページかブックマークレットが入れたもの：何もせず「すでに動いています」と出す（ページの `window.Arasuji` は拡張機能から見えないため）
- ポップアップでできること
  - このサイトでは開いたときに自動で使う：そのサイトの権限（`optional_host_permissions`）をその場で求め、許可されたサイトだけで、読み込みが終わったら差し込む。オフにすると権限も返す
    - 許可されたサイトのすべての frame に `auto.js` を登録する（`chrome.scripting.registerContentScripts`、`allFrames: true`）。frame が読み込まれるたびに動くので、iframe の中だけが入れ替わるサイト（次の教材へ移ったとき）でも入れ直せる
    - `auto.js` は、設定済みのサイトならどの frame からでも、それ以外のサイトなら外側のページからだけ動く（広告などの iframe に入れないため）。background からそのサイトの上書き設定を受け取り、frame の中で `probe` して節を数え、節があれば設定を `window.ARASUJI_CONFIG` に置いてから、background に `arasuji.js` の差し込みを頼む
    - 本文を JavaScript で後から入れるページがあるので、節が0なら DOM の変化を 30 秒まで見張り、変化が 0.5 秒落ち着くたびに数え直す
    - 登録は1つずつ順に行い、すでに登録があれば `updateContentScripts` で置き換える。chrome://extensions などで権限を外されたときは、そのサイトを「自動で使う」からも外す。ブラウザの起動時にも登録を合わせ直す
  - Alt+Shift+R/J/O のショートカットを使う：すべてのサイトで共通
  - このサイトの設定：コンテナ・見出し・終わりの目印を上書きする。`chrome.storage.local` にオリジンごとに保存する
- 拡張機能は自分のフォルダの中のファイルしか読めないので、`pnpm extension` で `public/arasuji.js` と `public/sites.js` を写してから読み込む。直すのは `public/` のほうだけにする

**できないこと**

- 要約データはないので、あらすじは要点を省いた文（どこまで・続き・残り）になる。ページの本文をその場で外部の AI に送って要約することはしない（本文を外へ送ることになり、「事前に生成して人が確認する」方針にも合わないため）
- ページ移動のたびに本文を JavaScript で入れ替えるサイトでは、2ページ目以降の節が合わない（1.2 の対象外のとおり）。iframe ごと読み込み直すサイトは、拡張機能の「自動で使う」なら入れ直せる。ブックマークレットでは、教材を移るたびに押し直す
- ブックマークレットと拡張機能は、ページを開き直すたびに入れ直す（拡張機能は「自動で使う」にしたサイトを除く）

## 5. ① コア

### 5.1 ページ ID

- `data-page-id` があればそれを使う
- なければ URL のパスの最後の部分から拡張子 `.html` を除いたもの
  - `/lesson/py-func.html` と `/lesson/py-func` はどちらも `py-func`（`serve` が拡張子なしの URL にリダイレクトするため、どちらでも同じになること）
  - 最後の部分が空（`/docs/` のように末尾が `/`）か `index`（`index.html`）なら、一つ上のディレクトリ名にする。`/docs/`・`/docs/index.html`・`/docs/index` はどれも `docs`
    - 末尾が `/` の URL は実在のサイトによくある（例：`/webaccessibility/guideline/` → `guideline`）。`index` にすると、そのサイトの全ページで進捗がぶつかるため
    - サイトのトップ（`/`・`/index.html`）だけは、上のディレクトリがないので `index`
  - パスの各部分は `decodeURIComponent` で戻す（日本語のディレクトリ名・ファイル名に対応する）
- ページ ID はディレクトリを1段までしか含まない。別のディレクトリに同じ名前のページがあるサイトでは、`data-namespace` で分けるか `data-page-id` を指定する

### 5.2 節の検出

ページの構造を読むだけで、書き換えない。

```js
const container = document.querySelector(cfg.container);
const endMarker = cfg.end ? container.querySelector(cfg.end) : null;
const headings = [...container.querySelectorAll(cfg.heading)]
  .filter(h => !(endMarker && endMarker.contains(h)));
```

- 節は `<section>` の有無ではなく、見出しの並びで決める（教材風の平らな構造とドキュメント風の入れ子構造の両方で動く）
- h3 などの下位の見出しは節として数えない（`data-heading` で指定したものだけ）
- コンテナが見つからない、または見出しが0個なら `null` を返し、console に警告だけ出す。以降は何もしない
- 節の番号（`order`）は1から始まる

### 5.3 ページ名

データの `title` → コンテナ内の h1 → `document.title` の順で決める。

### 5.4 要約データの参照

- `window.ARASUJI_DATA[pageId]` を参照する（形式は「8. 要約データ」）
- データがないページでは、要点を省いた文（どこまで・続き・残り）だけを組み立てる
- 節の見出しはページから取る（`textContent` の前後の空白を除き、連続する空白を1つに詰める）。節の要約（`summary`）はデータから取る
- データの節数とページの見出し数が合わないときは console に警告を出す

### 5.5 進捗の記録

**保存形式**

```
localStorage['arasuji:{namespace}:{pageId}'] = {"last": 読み終えた節の番号, "updatedAt": epoch ms}
```

- `last` は大きいほうを残す（「一番先まで読んだ位置」を記録する）
- `updatedAt` は `last` が増えたときだけ更新する。既読の節にフォーカスしただけで「今日は〜」に変わらないようにするため（あらすじ文の「前回は{いつ}」は、その節まで進んだ日を指す）
- `arasuji:change` は進捗が変わったとき（`last` が増えた、`reset()`、`setProgress()`）だけ出す。同じ値や小さい値を記録しようとしたときは出さない
- localStorage の読み書きはすべて try/catch で囲む。使えなければメモリに持つ

**記録のきっかけ**

| きっかけ | 記録する値 |
| --- | --- |
| `markRead(n)`（既定 UI の「次の節へ」ボタンのフォーカス・クリック、または自前 UI から呼ばれる） | n節まで |
| コンテナ内の要素への focusin | その要素がある節の前の節（N−1）まで |
| `endMarker` の中への focusin | 全節 |

- 要素がどの節に属するかは、次の式を満たす見出しの数で決める（入れ子でも平らでも同じ式で動く）。見出しそのもの（`h === el`）と見出しの中の要素も、その見出しの節に含める

  ```js
  const n = headings.filter(h =>
    h === el || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
  ).length;
  ```

- ③が差し込んだ要素（`arasuji-` で始まるクラスの要素とその中）は focusin の判定から除く（`markRead` で別に記録されるため）
- 最初の見出しより前（h1・導入・目次）と1節目の中への focusin は記録しない（N−1 が0以下になるため）
- `markRead(n)` に範囲外の値（0以下・節数超え）が来たら、1〜節数に丸める
- `setProgress(last, daysAgo)` は大きいほうを残さず、そのまま上書きする（デモで状態を作り直せるように）

### 5.6 あらすじ文（`getRecapText()`）

呼ぶたびに、その時点の進捗で組み立て直す（ページを開いた時点の進捗で固定しない）。

| 状態 | 文 |
| --- | --- |
| 未着手 | 「{ページ名}」はまだ始めていません。最初の節は「{節1}」です。全{n}節です。 |
| 途中（1日以上前） | 前回は{3日前／昨日}、「{最後の節}」の節まで進みました。続きは「{次の節}」からです。{points[last]}残り{n}節です。 |
| 途中（同じ日） | 今日は「{最後の節}」の節まで進みました。続きは「{次の節}」からです。{points[last]}残り{n}節です。 |
| 読了（1日以上前） | 前回は{3日前／昨日}、最後の節「{最後の節}」まで進みました。このページは最後まで読み終えています。 |
| 読了（同じ日） | 今日は最後の節「{最後の節}」まで進みました。このページは最後まで読み終えています。 |

- 経過日数は、端末のローカル時刻での日付の差で数える。1日なら「昨日」、2日以上なら「{N}日前」。上限は設けず、30日以上でも「{N}日前」と言う
- 同じ日に「前回は今日」とは言わず「今日は〜」にする
- 大事な順（どこまで → 続き → 要点 → 残り）に並べる。途中で読み上げを止める人がいるため
- 「ここまでの要点です。」のような前置きは入れない
- 長さの目標は、発表用の読み上げ速度で15秒前後。固定部分（どこまで・続き・残り）だけで45字前後になるので、要点は1文・30〜35字にする（合計80字ほど）

### 5.7 全体像の文（`getOverviewText()`）

```
「{ページ名}」は全4節、既読2節です。1、関数とは、既読。2、…、既読。3、…、未読、ここから。4、…、未読。
```

- 続きの節に「ここから」を付ける

### 5.8 デモ用パラメータ

`data-demo="on"` のときだけ受け付ける。

| パラメータ | 作る状態 |
| --- | --- |
| `?demo=3days` | 2節まで読んで3日たった状態 |
| `?demo=today` | 2節まで読んだ今日の状態 |
| `?demo=reset` | 進捗を消す |

- 状態を作ったら、パラメータを `history.replaceState` で URL から消す（再読み込みで状態が戻らないように）
- `setProgress(last, daysAgo)` で作る
- デモ用のリンクは拡張子なしの URL（`./lesson/py-func?demo=3days`、`./custom/?demo=3days`）にする。`serve` は `.html` 付きの URL を拡張子なしへリダイレクトするときにクエリを落とすため（`/lesson/py-func.html?demo=3days` → `/lesson/py-func`）

## 6. ② 読み上げ・フォーカス

### 6.1 ライブ通知領域

- `aria-live="polite" aria-atomic="true" lang="ja"` の空の div を、初期化時に `body` の末尾に置く（後から置くと読まれないことがある）
- `display:none` ではなく、視覚的に隠すスタイルを要素に直接当てる（③の CSS に頼らない。`data-ui="off"` でも隠れるように）

### 6.2 `announce(text)`

```js
function announce(text) {
  clearTimeout(timer);
  live.textContent = '';                                // 同じ文でも読ませるため一度空にする
  timer = setTimeout(() => {
    const item = document.createElement('p');           // 毎回新しい要素として入れる
    alternate = !alternate;
    item.textContent = alternate ? text : text + ' '; // 直前の文と同じにならないようにする
    live.replaceChildren(item);
    emit('arasuji:announce', { text });                 // イベントには元の文を渡す
  }, 150);
}
```

- 一度空にしても、直前と同じ文が入ったときは読み上げない環境（VoiceOver など）がある。そのため、毎回新しい要素として入れ、末尾のノーブレークスペースを交互に付け外しして、直前の文と文字列が同じにならないようにする
- ノーブレークスペースは読み上げに影響しない。字幕と `arasuji:announce` には付けない

### 6.3 `resume()`（続きへ）

- 次の節の見出しに `tabindex="-1"` を付けて `focus()` する
- 未着手（`last` が0）なら、最初の見出しより前にある導入部分の先頭へ移る（見出しへ移ると導入部分を読み飛ばすため）。見出しと同じく `tabindex="-1"` を付ける
  - 導入部分の先頭は、コンテナの中で h1（ページ名）より後ろ、最初の見出しより前にあり、文字を含む最初の要素。h1 そのものと③の要素（`arasuji-` で始まるクラス）は飛ばす。h1 から読むと、すぐ後ろのあらすじ欄をもう一度読むことになるため
  - h1 より前にある要素は導入部分にしない。実在のサイトでは、コンテナの中の h1 より前にパンくずリストなどが置かれることがあるため（例：総務省の情報アクセシビリティポータルサイト）
  - コンテナに h1 がない、または h1 が最初の見出しより後ろにあるときは、コンテナの先頭から探す
  - 最初の見出しが入れ子（`<section>` の中など）なら、その親をたどって探す
  - 導入部分がなければ、最初の見出しへ移る
  - 導入部分へのフォーカスは記録しない（5.5）ので、移っても未着手のまま
- 読了なら最後の節の見出しへ移る（「このページを読み終える」ボタンからは呼ばない。7.2）
- フォーカスを動かすのはこの操作のときだけ。読み込み時などに勝手に動かさない
- 実機で読み上げ位置が移らない環境（iOS の VoiceOver など）があれば、移った先の見出し名を aria-live でも読み上げる

### 6.4 ショートカット

`data-shortcuts="on"` のときだけ有効にする。

| キー | 動作 |
| --- | --- |
| Alt+Shift+R | `recap()` |
| Alt+Shift+J | `resume()` |
| Alt+Shift+O | `overview()` |

- キーは `e.code`（`KeyR` など）で判定する。Alt+Shift を押していると `e.key` が変わるため（macOS では Option+Shift+R が `‰` になる）
- input・textarea・select・contenteditable にフォーカスがあるときは何もしない（macOS では Option+Shift+R などが文字入力になるため）
- 処理したキーは `preventDefault()` する
- 実機で横取りされる場合は別のキーに変え、ボタンでの操作を主にする

### 6.5 自動読み上げ

- 利用者の設定（localStorage）→ `data-autoplay` の順で決める
- オンなら初期化の1.5秒後に `recap()`（直後の通知は取りこぼされやすいため）
- `setAutoplay(bool)` で変えた値を localStorage に保存する

**保存形式**

```
localStorage['arasuji-settings:{namespace}'] = {"autoplay": true}
```

- 範囲は namespace 全体（同じサイトならどのページでも同じ設定）。読み上げの好みはページごとに変える理由がないため
- 接頭辞を進捗（`arasuji:`）と分け、ページ ID とぶつからないようにする
- 値はオブジェクトにして、後から設定を足せるようにする。キーがない、または `autoplay` がないときは `data-autoplay` に従う
- 読み書きは進捗と同じく try/catch で囲み、使えなければメモリに持つ

## 7. ③ 既定 UI

共通：

- 差し込む要素のクラス名と id はすべて `arasuji-` で始め、`lang="ja"` を付ける
- `window.Arasuji` の API とイベントだけを使う
- ページや要約データから取った文字列は `textContent` で入れる（`innerHTML` を使わない）

### 7.1 あらすじ欄

- 位置：コンテナ内の最初の h1 の直後。なければコンテナの先頭
- `<section aria-labelledby>` で、中身は次のとおり
  - 見出し「前回のあらすじ」。見出しのレベルは節の見出しと同じにする（NVDA の H キーなど、見出しジャンプで辿れるように）。最初の節の見出しが h1〜h6 ならそのタグ、そうでなければ h2
  - あらすじの文。`arasuji:change` を受けて `getRecapText()` で書き直す
  - ボタン3つ：もう一度聞く（`recap()`）／続きから読む（`resume()`）／全体像を聞く（`overview()`）
  - 「進捗を消す」ボタン：`reset()` のあと「このページの進捗を消しました。」を `announce()` する
    - 終わりの目印へのフォーカスなどで誤って読了になったとき、戻せるようにするため
    - 押し間違えないよう、ほかの3つと離して置き、見た目を控えめにする
  - 自動読み上げのチェックボックス（`setAutoplay`）
  - ショートカットの説明（有効なときだけ）
  - 字幕（7.3）

### 7.2 「次の節へ」ボタン

- 各節の末尾に入れる。ラベルは「次の節へ（{次の節名}）」、最後の節は「このページを読み終える」
- フォーカスまたはクリックで `markRead(n)`。クリックではさらに `resume()`
  - 最後の節のボタン（「このページを読み終える」）は、クリックで `resume()` を呼ばず、フォーカスをボタンに置いたまま「このページを読み終えました。」を `announce()` する
  - 読了後の `resume()` は最後の節の見出しへ移る（6.3）ため、呼ぶとボタンより上へ戻ってしまう
- 入れる位置
  - 見出しの親要素が `<section>`（コンテナ自身を除く）で、次の見出しがその `<section>` の外にあれば、その `<section>` の末尾（ドキュメント風）
  - 次の見出しが同じ `<section>` の中にあるか、親が `<section>` でなければ、次の見出しの直前（教材風）
    - 次の見出しで見るのは、1つの `<section>` に見出しが複数あるページがあるため。教材風のページは `<section class="main-content markdown-section">` の直下に h2 が並ぶ。コンテナがその `<section>` 自身でないとき（拡張機能でコンテナを `main` にしたときなど）、親だけで判定すると、すべてのボタンが `<section>` の末尾に並んでしまう。一部の `<section>` にだけ見出しが複数あるページでも、節ごとに正しい位置に入る
  - 最後の節：親が `<section>` で、その中に `endMarker` がなければ、その `<section>` の末尾。そうでなければ `endMarker` の直前、なければコンテナの末尾

### 7.3 字幕と光らせる演出

スクリーンリーダーなしで見る人（デモの観客）に、ボタンを押して何かが起きたと分かるようにする。

- 字幕：あらすじ欄の中に `aria-hidden="true"` の段落を置き、`arasuji:announce` を受けて「読み上げ：〜」と表示する
- 光らせる演出：`arasuji:announce` を受けてあらすじ欄を一瞬光らせる。`prefers-reduced-motion` のときは止める

### 7.4 CSS

- `<style>` を差し込み、`arasuji-` の要素にだけ当てる
- 色は `var(--arasuji-accent)`
- スマホの幅で崩れないこと

## 8. 公開 API とイベント

### 8.1 `window.Arasuji`

①コア（読み上げない。値を返すか、進捗を変えるだけ）：

| API | 内容 |
| --- | --- |
| `getState()` | `{ pageId, title, sections: [{ order, heading, summary, read }], last, updatedAt, next }`。`last` は読み終えた節の番号（未着手は `0`）、`updatedAt` は未着手なら `null`、`next` は続きの節の番号（読了なら `null`）、`summary` はデータがなければ `null` |
| `getRecapText()` | その時点の進捗であらすじ文を組み立てて返す |
| `getOverviewText()` | 全体像の文を返す |
| `markRead(n)` | n節まで読んだと記録する（大きいほうを残す） |
| `reset()` | このページの進捗を消す |
| `setProgress(last, daysAgo)` | デモ用に進捗を作る |

②読み上げ・フォーカス：

| API | 内容 |
| --- | --- |
| `announce(text)` | aria-live で読ませる |
| `recap()` | `announce(getRecapText())` |
| `overview()` | `announce(getOverviewText())` |
| `resume()` | 続きの節の見出しへフォーカスを移す |
| `setAutoplay(bool)` | 自動読み上げの設定を変えて保存する |

その他：

| API | 内容 |
| --- | --- |
| `ready` | 初期化が終わると `getState()` の値で解決する Promise（`arasuji:ready` の取りこぼし対策） |

### 8.2 イベント

`document` に `CustomEvent` で出す。

| イベント | `detail` | きっかけ |
| --- | --- | --- |
| `arasuji:ready` | `getState()` の値 | 初期化が終わった |
| `arasuji:change` | `getState()` の値 | 進捗が変わった |
| `arasuji:announce` | `{ text }` | 読み上げた（字幕の表示に使う） |

## 9. 要約データ（`arasuji-data.js`）

```js
window.ARASUJI_DATA = Object.assign(window.ARASUJI_DATA || {}, {
  "py-func": {
    "title": "Python入門：関数",
    "sections": [
      { "order": 1, "heading": "関数とは", "summary": "この節で学ぶこと1文" }
    ],
    "points": {
      "1": "1節まで読んだときの「ここまでの要点」",
      "2": "…"
    }
  }
});
```

- キーはページ ID
- `points[n]`：1〜n節を読んだ時点の「ここまでの要点」（1文・35字以内、「。」で終わる）
- JSON ではなく JS にする（`file://` で直接開いても fetch なしで読めるように）
- `Object.assign` にして、複数のデータファイルを読み込めるようにする

## 10. 生成スクリプト（`scripts/generate.mjs`）

### 10.1 設定ファイル（`arasuji.config.json`）

```json
{
  "ai": { "provider": "workers-ai", "model": "@cf/…" },
  "sites": [
    {
      "input": "public/lesson",
      "output": "public/lesson/arasuji-data.js",
      "container": ".markdown-section",
      "heading": "h2",
      "end": ".share-button-wrapper"
    },
    {
      "input": "public/docs",
      "output": "public/docs/arasuji-data.js",
      "container": "main",
      "heading": "h2"
    }
  ]
}
```

HTML パーサーを使わないため、セレクタは arasuji.js より単純に扱う。

| 項目 | 書き方 |
| --- | --- |
| `container` | タグ名、またはクラス名（`.` 始まり） |
| `heading` | タグ名 |
| `end` | クラス名（`.` 始まり） |

デモページはこの範囲で切り出せる書き方にしておく。

- `heading` はコンテナの中の該当タグをすべて数える（arasuji.js のプリセットは直下だけ）。数がずれないよう、デモページでは節の見出しと同じタグをほかの場所に置かない（11.1）

### 10.2 処理の流れ

1. 各サイトの `input` の `*.html` を読み、コンテナの中を終わりの目印の手前まで切り出す
2. 見出しタグで分割する。先頭のかたまり（h1・導入・目次）は捨てる。本文テキストにする
   - `<script>`・`<style>` は中身ごと除く
   - img に alt があれば alt を本文として扱う
   - タグを除き、文字参照（`&lt;`・`&gt;`・`&amp;`・`&quot;`・`&#39;`・`&#数字;` など）を戻し、空白を詰める
3. 節ごとに AI で節要約を作る（10.3）
4. n=1〜節数のそれぞれについて、1〜n節の要約を渡して「ここまでの要点」を作る
5. 出力を後処理する（10.5）
6. `output` に arasuji-data.js の形で書き出す
7. `--no-ai`（`pnpm generate:dry`）のときは、本文の1文目で仮の要約・要点を作る（API を呼ばない）。これも 10.5 の後処理を通す

ページ ID はファイル名から拡張子を除いたもの、`title` はページの h1 から取る。`index.html` だけは、`input` のディレクトリ名をページ ID にする（arasuji.js の 5.1 と揃える）。

### 10.3 AI の呼び出し

`ai.provider` でプロバイダーを選ぶ。どれも system プロンプトと user の入力（10.4）を1往復で送り、出力の文字列だけを取り出す。

| `provider` | 送り先 | 認証 | 出力の取り出し |
| --- | --- | --- | --- |
| `workers-ai` | `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{model}` | `Authorization: Bearer {CLOUDFLARE_API_TOKEN}` | `result.response` または `result.choices[0].message.content`（モデルによって違うので両方に対応する） |
| `openai` | `POST {baseURL}/chat/completions`（`baseURL` の既定は `https://api.openai.com/v1`） | `Authorization: Bearer {OPENAI_API_KEY}`。キーがなければ付けない（ローカルの Ollama など） | `choices[0].message.content` |
| `anthropic` | `POST {baseURL}/v1/messages`（`baseURL` の既定は `https://api.anthropic.com`） | `x-api-key: {ANTHROPIC_API_KEY}`、`anthropic-version: 2023-06-01` | `content` の `type: "text"` のブロックをつなぐ。`stop_reason` が `refusal` なら空にして警告する |

`ai` に書ける項目。

| 項目 | 意味 |
| --- | --- |
| `provider` | `workers-ai`・`openai`・`anthropic` |
| `model` | モデル名 |
| `baseURL` | `openai`・`anthropic` の送り先を変える |
| `apiKeyEnv` | `openai`・`anthropic` で API キーを読む環境変数の名前を変える |
| `effort` | `anthropic` だけ。`output_config.effort` に渡す（`low` など） |

- 旧形式（トップレベルの `model` だけ）は `workers-ai` として扱う

### 10.4 プロンプト

| 用途 | system プロンプト | user の入力 |
| --- | --- | --- |
| 節要約 | 文書の1節を読み、「この節で学ぶこと」を日本語1文で書いてください。用語は本文の表記に合わせ、本文にない情報は足さないでください。出力は1文のみ。 | 節の本文テキスト |
| 要点 | 読者が文書を再開するときに思い出すべきことを、与えられた節要約だけを材料にして、日本語1文・35字以内にまとめてください。用語は本文の表記に合わせ、本文にない情報は足さないでください。出力は要約文のみ。 | 「「見出し」：要約」を1行ずつ並べたもの |

生成した出力は、必ず人が目で確認してから使う。

### 10.5 出力の後処理

モデルの出力は、字数を超える・前置きや括弧が付く・改行する・句点が落ちる、といった崩れ方をする。書き出す前に次の順で整える。

1. 思考タグ `<think>…</think>` を中身ごと除く
2. 空でない最初の行だけを取る
3. 先頭の前置き（「要約：」「要点：」など）と、全体を囲む括弧・引用符（「」『』""）を除く
4. 末尾を「。」で揃える（あらすじ文では `{points[last]}残り{n}節です。` とつなぐため、句点がないと文がつながる）
5. 要点が35字を超えたら警告を出す。切り詰めはしない（人が確認して直す）

- 警告はページ ID と節の番号を付けて console に出す

## 11. デモページ

本文はすべて自作する。

### 11.1 教材風（`public/lesson/`）

```html
<div class="book">
  <div class="book-header" role="navigation">
    <a href="../index.html">教材一覧へ</a>
    <h1>Python入門：関数</h1>
  </div>
  <div class="page-wrapper" tabindex="-1" role="main">
    <section class="main-content markdown-section">
      <h1 id="top">Python入門：関数</h1>
      <p>導入文</p>
      <ul id="toc">…目次…</ul>
      <h2 id="sec-1">関数とは</h2>
      <p>…</p>
      <h2 id="sec-2">関数の定義</h2>
      <p>…</p>
      <h3>小見出し（節の区切りにはしない）</h3>
      …
      <div class="share-button-wrapper"><h2 class="ending-h2">お疲れさまでした！</h2></div>
    </section>
  </div>
</div>
```

- `<main>` がない。本文は `.markdown-section`
- 節は `<section>` で囲まれず、`.markdown-section` 直下の `h2` が平らに並ぶ
- 最後の `h2.ending-h2` は節ではない
- 終わりの目印の中を除き、h2 は `.markdown-section` の直下にだけ置く。囲み記事の中などに h2 を置かない（プリセットは直下だけを数え、生成スクリプトは直下かどうかを区別しないため、置くと節数がずれる）
- 実在の教材サイトによくある、`<html lang="">` が空、画像に alt がない状態も再現してよい

### 11.2 ドキュメント風（`public/docs/`）

教材風とわざと違う構造にする。

```html
<header>…サイト名…</header>
<nav>…サイドバー…</nav>
<main>
  <h1>はじめに</h1>
  <section><h2>インストール</h2><p>…</p></section>
  <section><h2>設定</h2><p>…</p></section>
  <section><h2>使い方</h2><p>…</p></section>
</main>
```

- script 2行（汎用の書き方に `data-demo="on"` を足したもの。ショートカットは既定のオフ）だけで動くこと

### 11.3 自前 UI の例（`public/custom/`、任意）

- ドキュメント風のページを複製し、`data-ui="off"` にする
- 画面下に固定した自作の操作バーを置く：あらすじ・続きへ・全体像のボタン、「この節を読んだ」ボタン（`markRead`）、現在位置の表示（「2／4節」）
  - 「この節を読んだ」は既定 UI の「次の節へ」と同じく、最後の節ではフォーカスを動かさない（7.2）
  - 読了後は `disabled` ではなく `aria-disabled="true"` にする（`disabled` にすると、押した直後にフォーカスが body へ落ちる）
- 既定 UI とまったく違う見た目にし、「見た目は自由、読み上げは同じ」を示す

### 11.4 一覧ページ（`public/index.html`）

- 各デモページへのリンクと、デモ用リンク（`?demo=3days`、`?demo=today`、`?demo=reset`）を置く
- デモ用リンクは拡張子なしの URL にする（5.8）
- ブックマークレットの登録ページ（`bookmarklet.html`、4.6）へのリンクを置く

## 12. 割り切りと既知の制約

| 項目 | 内容 | 本番での方向 |
| --- | --- | --- |
| 記録する位置 | 「最後に読んだ位置」ではなく「一番先まで読んだ位置」 | 復習用に「最後に見ていた節」も別に持つ |
| データのずれ | 節の番号で引くため、ページを直すとずれる | 見出しの id で引くか、ページの版のハッシュを持つ |
| 字幕 | `aria-hidden` なので、拡大鏡とスクリーンリーダーの併用者には見える文と読まれる文が別物になる | 字幕をなくし、あらすじの文を更新するだけにする |
| 進捗 | 端末ごと | ログインに結び付けてサーバーに持つ（①の保存先を差し替える） |
| 画像 | alt のない画像は要約の材料にならない | AI による alt 候補の生成 |
| 既読判定 | ブラウズモードでボタンを通り過ぎただけでは既読にならない環境がある | スクロール位置による補助判定（13.） |
| 読了の判定 | 終わりの目印にフォーカスしただけで読了になり、`last` は減らないので戻らない。あらすじ欄の「進捗を消す」で戻す | 最終節の「このページを読み終える」ボタンでだけ読了にする |
| ページ ID | ファイル名（`index` と末尾 `/` はディレクトリ名）だけで決めるので、別のディレクトリにある同じ名前のページは進捗がぶつかる | パス全体か、サイト側の ID を使う |
| ショートカット | Windows の Firefox では Alt+Shift がアクセスキーの修飾キーと重なる。今回は Mac でデモするので対応しない | 実機で確かめ、キーを設定で変えられるようにする |
| 利用者が入れるとき（4.6） | 要約データがなく要点が入らない。設定済みでないサイトでは、利用者がコンテナと見出しのセレクタを知る必要がある | 見出しをクリックで選ぶ UI。サイト運営者が arasuji-data.js を公開する仕組み |
| 拡張機能 | Chrome だけ。ストアには出していない（読み込みは開発者モード） | Firefox 対応（`browser_specific_settings`）、ストアへの公開 |

## 13. 拡張（任意）

- スクロール位置による補助判定（①）：IntersectionObserver で「どの節の見出しまで画面に入ったか」を記録する。晴眼者の流し見でも記録されるので、「読んだ」ではなく「ここまで来た」として `markRead` より弱い判定にする
- 自前 UI の例（11.3）

## 14. 受け入れ基準

ブラウザ（スクリーンリーダーなし）：

- [ ] 未着手で開くと「まだ始めていません」と出る
- [ ] 「次の節へ」で次の節見出しにフォーカスが移り、進捗が保存される
- [ ] `?demo=3days` で開くと「前回は3日前、〜」になり、URL からパラメータが消える
- [ ] `?demo=3days` で開き「続きから読む」で見出しへ移ったあとも、「もう一度聞く」の文は「前回は3日前、〜」のまま
- [ ] 読み進めてから「もう一度聞く」を押すと、文が更新される
- [ ] 「進捗を消す」を押すと「まだ始めていません」に戻る
- [ ] 「続きへ」と全体像がボタンでもキーでも動く
- [ ] 最後の節まで読むと「最後まで読み終えています」になる
- [ ] 「このページを読み終える」を押しても、フォーカスがボタンから動かない
- [ ] 未着手で「続きから読む」を押すと、最初の見出しではなく導入部分の先頭へ移る
- [ ] ドキュメント風のページでも、script 2行だけで同じことができる
- [ ] ドキュメント風のページでは、ショートカットが既定でオフになっている
- [ ] `data-ui="off"` にすると、ライブ通知領域以外は何も差し込まれない。コンソールから `Arasuji.recap()`／`markRead(2)`／`resume()` を呼ぶと動き、`arasuji:change`／`arasuji:announce` が出る
- [ ] データファイルがないページでも、要点なしの文で動く
- [ ] `/lesson/py-func.html` と `/lesson/py-func` のどちらで開いても同じ進捗・データを引く
- [ ] 末尾が `/` の URL（`/docs/`）では、ページ ID が `index` ではなくディレクトリ名（`docs`）になる
- [ ] h1 より前にパンくずリストがあるページで、未着手の「続きから読む」がパンくずリストへ移らない
- [ ] arasuji.js が動いているページでもう一度読み込んでも、UI が二重にならない
- [ ] arasuji.js を入れていないページで、ブックマークレットを押すと UI が入る。もう一度押すとあらすじが読まれる
- [ ] 節の見出しが見つからないページでブックマークレットを押すと、そう知らせる
- [ ] 拡張機能の「このページで使う」で UI が入る。もう一度押すとあらすじが読まれる
- [ ] CSP で外部の script を止めているページ（ブックマークレットは読み込めない）でも、拡張機能は使える
- [ ] 拡張機能の「このサイトの設定」で見出しを変えると、その見出しで節を数える
- [ ] 本文が2段下の同じオリジンの iframe にあるページで、ブックマークレットも拡張機能も、本文の iframe にだけ UI を入れる
- [ ] 拡張機能の「自動で使う」で、教材の iframe だけが別の教材に入れ替わったときも UI が入り直す
- [ ] あらすじの読み上げが15秒前後に収まっている（発表用の速度で計る）
- [ ] スマホの幅で表示が崩れない

NVDA＋Chrome／VoiceOver＋Safari：

- [ ] 見出しジャンプで「前回のあらすじ」に辿り着ける
- [ ] ボタンを押すとあらすじが読まれ、もう一度押しても再度読まれる
- [ ] 読み込み時にフォーカスが勝手に動かない
- [ ] ブラウズモードで Alt+Shift+R/J/O が横取りされない
- [ ] 英語の用語（def、return など）が混ざっても読み方が崩れない
- [ ] 自動読み上げをオンにすると、開いたときに読まれる

## 15. 決定事項と未決事項

ガイドに書かれておらず、実装時に決めたもの。決めた内容は各節に書き込んである。

| 項目 | 決めたこと | 書いた節 |
| --- | --- | --- |
| 読了時の文の前半 | 「前回は{いつ}、最後の節「{最後の節}」まで進みました。」（同じ日は「今日は最後の節〜」） | 5.6 |
| `markRead(n)` の範囲外の値 | 1〜節数に丸める | 5.5 |
| 導入部分（最初の見出しより前）への focusin | 記録しない | 5.5 |
| `setProgress` と既存の進捗 | 大きいほうを残さず、そのまま上書きする | 5.5 |
| 「N日前」の上限 | 設けない。そのまま「{N}日前」 | 5.6 |
| 「このページを読み終える」のフォーカス | `resume()` を呼ばず、ボタンに置いたままにする | 7.2 |
| デモ用リンクの URL | 拡張子なしにする（`serve` のリダイレクトでクエリが消えるため） | 5.8 |
| 末尾が `/` の URL のページ ID | `index` ではなく一つ上のディレクトリ名にする | 5.1・10.2 |
| 未着手の「続きから読む」の移り先 | 最初の見出しより前の導入部分。h1 より前（パンくずなど）は含めない | 6.3 |
| 利用者が自分で入れる方法 | ブックマークレットと Chrome 拡張機能の両方を作る。設定は `window.ARASUJI_CONFIG` でも受け取り、二重に動かないようにする | 4.6 |
| 本文が iframe の中にあるサイト | iframe をたどって本文のある文書を選び、その中に入れる。`pageId` で URL からページ ID を作れる | 4.6 |
| 「次の節へ」を `<section>` の末尾に入れる条件 | 次の見出しがその `<section>` の外にあるとき（最後の節は、その中に終わりの目印がないとき） | 7.2 |
| 一覧にないサイトでの iframe の扱い | 外側のページに節があれば iframe には入れない | 4.6 |

まだ決めていないもの。

- **使用する AI のモデル**：前日に2〜3個試して、日本語の自然さで1つに決める。いまの `arasuji.config.json` には仮に `@cf/meta/llama-3.3-70b-instruct-fp8-fast` を入れてある
- **Cloudflare Pages での `?demo=` の扱い**：Pages も `.html` 付きの URL を拡張子なしへリダイレクトする。そのときクエリが残るかは確かめていない。拡張子なしのリンク（5.8）なら影響はない
- **拡張機能のショートカット Alt+Shift+A**：ほかの拡張機能やサイトとぶつからないかは確かめていない。ぶつかったら `chrome://extensions/shortcuts` で変えられる
