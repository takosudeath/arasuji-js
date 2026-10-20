// jsdom のページに public/arasuji.js を読み込む。
// arasuji.js は document.currentScript の data 属性で設定を受け取るので、実際のページと同じく script 要素として実行する
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const CODE = fs.readFileSync(new URL('../../public/arasuji.js', import.meta.url), 'utf8');

// 教材風（節を <section> で囲まない平らな構造）。3節
export const LESSON = `
  <div class="book-header"><h1>ヘッダーの題</h1></div>
  <section class="markdown-section">
    <h1>関数の教材</h1>
    <p id="intro">導入の文です。<a id="a0" href="#">リンク</a></p>
    <h2 id="s1">関数とは</h2>
    <p id="p1">一つ目の本文。<a id="a1" href="#">リンク</a></p>
    <h2 id="s2">関数の定義</h2>
    <p id="p2">二つ目の本文。<a id="a2" href="#">リンク</a></p>
    <h2 id="s3">引数と戻り値</h2>
    <p id="p3">三つ目の本文。<a id="a3" href="#">リンク</a></p>
    <div class="share-button-wrapper"><h2>共有する</h2><a id="share" href="#">共有</a></div>
  </section>`;

// ドキュメント風（節を <section> で囲む）。3節
export const DOCS = `
  <main>
    <h1>はじめに</h1>
    <p id="intro">導入の文です。</p>
    <section id="sec1"><h2 id="s1">インストール</h2><p>本文1</p></section>
    <section id="sec2"><h2 id="s2">設定</h2><p>本文2</p></section>
    <section id="sec3"><h2 id="s3">公開</h2><p>本文3</p></section>
  </main>`;

// jsdom の中で作られた配列やオブジェクトは、deepStrictEqual でプロトタイプが合わないので、こちらの世界に写す
export const plain = v => JSON.parse(JSON.stringify(v));

const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * @param {object} o
 * @param {string} o.body       <body> の中身
 * @param {object} [o.attrs]    script 要素の data 属性（data- を除き、ケバブケース）
 * @param {string} [o.url]
 * @param {object} [o.data]     window.ARASUJI_DATA
 * @param {object} [o.config]   window.ARASUJI_CONFIG。指定すると script 要素を通らずに実行する（拡張機能と同じ）
 * @param {object} [o.storage]  あらかじめ localStorage に入れておく値（JSON にして入れる）
 * @param {(window) => void} [o.setup]  ページを読み込む前に window に手を加える
 */
export async function load({
  body = LESSON, attrs = {}, url = 'https://example.com/lesson/page.html', title = '文書の題',
  data, config, storage = {}, setup,
} = {}) {
  const logs = [];
  const virtualConsole = new VirtualConsole();
  for (const level of ['log', 'info', 'warn', 'error']) {
    virtualConsole.on(level, (...args) => logs.push({ level, text: args.join(' ') }));
  }
  virtualConsole.on('jsdomError', e => logs.push({ level: 'jsdomError', text: e.stack || e.message }));

  const events = [];
  const dataScript = data ? `<script>window.ARASUJI_DATA = ${JSON.stringify(data)};</script>` : '';
  const dataset = Object.entries(attrs).map(([k, v]) => ` data-${k}="${escapeAttr(v)}"`).join('');
  const mainScript = config ? '' : `<script${dataset}>${CODE}</script>`;

  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="ja"><head><title>${title}</title></head><body>${body}${dataScript}${mainScript}</body></html>`,
    {
      url,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, JSON.stringify(v));
        for (const name of ['arasuji:ready', 'arasuji:change', 'arasuji:announce']) {
          window.document.addEventListener(name, e => events.push({ name, detail: e.detail }));
        }
        if (setup) setup(window);
      },
    },
  );
  const { window } = dom;

  if (config) {
    window.ARASUJI_CONFIG = config;
    window.eval(CODE);
  }
  if (window.document.readyState === 'loading') {
    await new Promise(r => window.document.addEventListener('DOMContentLoaded', r));
  }

  return {
    dom,
    window,
    document: window.document,
    api: window.Arasuji,
    events,
    logs,
    $: sel => window.document.querySelector(sel),
    $$: sel => [...window.document.querySelectorAll(sel)],
    stored: key => {
      const raw = window.localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    },
    /** 同じページにもう一度 arasuji.js を入れる（ブックマークレットを2回押したときなど） */
    runAgain: cfg => {
      window.ARASUJI_CONFIG = cfg;
      window.eval(CODE);
    },
  };
}

/** 次の arasuji:announce を待って、読み上げた文を返す */
export function nextAnnounce(document, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('arasuji:announce が来ませんでした')), timeout);
    document.addEventListener('arasuji:announce', e => {
      clearTimeout(timer);
      resolve(e.detail.text);
    }, { once: true });
  });
}

/** Alt+Shift+キー を押す */
export function pressShortcut(window, code, target = window.document.body, extra = {}) {
  const e = new window.KeyboardEvent('keydown', {
    code, altKey: true, shiftKey: true, bubbles: true, cancelable: true, ...extra,
  });
  target.dispatchEvent(e);
  return e;
}
