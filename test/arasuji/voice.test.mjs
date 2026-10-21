// ② 読み上げ・フォーカス：aria-live への通知、「続きへ」のフォーカス移動、ショートカット、自動読み上げ
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { load, nextAnnounce, pressShortcut, LESSON, DOCS } from './load.mjs';

const lesson = (o = {}) => load({ body: LESSON, ...o, attrs: { preset: 'lesson', ...o.attrs } });

describe('ライブ通知領域', () => {
  test('body の末尾に1つ置き、視覚的に隠す', async () => {
    const p = await lesson({ attrs: { ui: 'off' } });
    const live = p.$('#arasuji-live');
    assert.equal(live.parentElement, p.document.body);
    assert.equal(live.getAttribute('aria-live'), 'polite');
    assert.equal(live.getAttribute('aria-atomic'), 'true');
    assert.equal(live.getAttribute('lang'), 'ja');
    assert.equal(live.style.width, '1px');
    assert.equal(live.style.overflow, 'hidden');
    assert.equal(live.textContent, '');
  });

  test('announce は一度空にしてから、新しい要素として文を入れる', async () => {
    const p = await lesson();
    const live = p.$('#arasuji-live');
    const done = nextAnnounce(p.document);
    p.api.announce('一回目');
    assert.equal(await done, '一回目');
    const first = live.firstElementChild;
    assert.equal(first.textContent.trim(), '一回目');

    p.api.announce('二回目');
    assert.equal(live.textContent, '', 'すぐに空にする');
    await nextAnnounce(p.document);
    assert.equal(live.children.length, 1);
    assert.notEqual(live.firstElementChild, first);
  });

  test('同じ文を続けて読ませても、直前と同じ文字列にならない', async () => {
    const p = await lesson();
    const live = p.$('#arasuji-live');
    const texts = [];
    for (let i = 0; i < 3; i++) {
      const done = nextAnnounce(p.document);
      p.api.announce('同じ文');
      await done;
      texts.push(live.textContent);
    }
    assert.notEqual(texts[0], texts[1]);
    assert.notEqual(texts[1], texts[2]);
    assert.ok(texts.every(t => t.trim() === '同じ文'));
  });

  test('続けて呼ぶと、最後の文だけを読む', async () => {
    const p = await lesson();
    const done = nextAnnounce(p.document);
    p.api.announce('古い');
    p.api.announce('新しい');
    assert.equal(await done, '新しい');
    await new Promise(r => setTimeout(r, 250));
    assert.equal(p.events.filter(e => e.name === 'arasuji:announce').length, 1);
  });

  test('recap と overview は、その時点の文を読む', async () => {
    const p = await lesson();
    p.api.markRead(1);
    let done = nextAnnounce(p.document);
    p.api.recap();
    assert.equal(await done, p.api.getRecapText());
    done = nextAnnounce(p.document);
    p.api.overview();
    assert.equal(await done, p.api.getOverviewText());
  });
});

describe('resume（続きへ）', () => {
  test('途中なら、続きの節の見出しへフォーカスを移す', async () => {
    const p = await lesson();
    p.api.markRead(1);
    p.api.resume();
    const h = p.$('#s2');
    assert.equal(p.document.activeElement, h);
    assert.equal(h.getAttribute('tabindex'), '-1');
  });

  test('見出しにすでに tabindex があれば変えない', async () => {
    const p = await lesson({ body: LESSON.replace('<h2 id="s2">', '<h2 id="s2" tabindex="0">') });
    p.api.markRead(1);
    p.api.resume();
    assert.equal(p.document.activeElement, p.$('#s2'));
    assert.equal(p.$('#s2').getAttribute('tabindex'), '0');
  });

  test('読み終えていれば、最後の節の見出しへ', async () => {
    const p = await lesson();
    p.api.markRead(3);
    p.api.resume();
    assert.equal(p.document.activeElement, p.$('#s3'));
  });

  test('未着手なら、h1 の後ろの導入部分の先頭へ（ヘッダーや既定 UI は飛ばす）', async () => {
    const p = await lesson();
    p.api.resume();
    const intro = p.$('#intro');
    assert.equal(p.document.activeElement, intro);
    assert.equal(intro.getAttribute('tabindex'), '-1');
  });

  test('h1 より前のパンくずは導入部分にしない', async () => {
    const body = `<main>
      <nav id="crumbs">ホーム &gt; 文書</nav>
      <div><h1>題</h1><p id="lead">リード文</p></div>
      <h2 id="s1">一</h2><h2>二</h2></main>`;
    const p = await load({ body, attrs: { ui: 'off' } });
    p.api.resume();
    assert.equal(p.document.activeElement.id, 'lead');
  });

  test('空の要素・script・hidden の要素は導入部分にしない', async () => {
    const body = `<main><h1>題</h1><div></div><script>1</script><p hidden>隠し</p>
      <p id="lead">リード文</p><h2 id="s1">一</h2></main>`;
    const p = await load({ body, attrs: { ui: 'off' } });
    p.api.resume();
    assert.equal(p.document.activeElement.id, 'lead');
  });

  test('data-intro-skip に合う要素（記事の日付など）は導入部分にしない', async () => {
    const body = `<article><header><h1>題</h1><p class="post-meta">公開日: 2026年10月21日</p></header>
      <nav><a href="#s1">目次</a></nav><p id="lead">リード文</p><h2 id="s1">一</h2></article>`;
    const p = await load({ body, attrs: { container: 'article', ui: 'off', 'intro-skip': '.post-meta, nav' } });
    p.api.resume();
    assert.equal(p.document.activeElement.id, 'lead');
  });

  test('data-intro-skip のセレクタが不正なら、警告して使わない', async () => {
    const body = '<main><h1>題</h1><p id="lead">リード文</p><h2>一</h2></main>';
    const p = await load({ body, attrs: { ui: 'off', 'intro-skip': '[[[' } });
    p.api.resume();
    assert.equal(p.document.activeElement.id, 'lead');
    assert.ok(p.logs.some(l => l.level === 'warn' && l.text.includes('data-intro-skip')));
  });

  test('導入部分がなければ、最初の見出しへ', async () => {
    const p = await load({ body: '<main><h1>題</h1><h2 id="s1">一</h2><h2>二</h2></main>', attrs: { ui: 'off' } });
    p.api.resume();
    assert.equal(p.document.activeElement.id, 's1');
  });

  test('resume 以外ではフォーカスを動かさない', async () => {
    const p = await lesson();
    const before = p.document.activeElement;
    p.api.markRead(2);
    const done = nextAnnounce(p.document);
    p.api.recap();
    await done;
    assert.equal(p.document.activeElement, before);
  });
});

describe('ショートカット', () => {
  test('Alt+Shift+R であらすじ、O で全体像、J で続きへ', async () => {
    const p = await lesson({ attrs: { shortcuts: 'on' } });
    p.api.markRead(1);

    let done = nextAnnounce(p.document);
    const e = pressShortcut(p.window, 'KeyR');
    assert.equal(e.defaultPrevented, true);
    assert.equal(await done, p.api.getRecapText());

    done = nextAnnounce(p.document);
    pressShortcut(p.window, 'KeyO');
    assert.equal(await done, p.api.getOverviewText());

    pressShortcut(p.window, 'KeyJ');
    assert.equal(p.document.activeElement, p.$('#s2'));
  });

  test('入力欄の中では動かない', async () => {
    const p = await lesson({ attrs: { shortcuts: 'on' }, body: `${LESSON}<input id="q"><textarea id="t"></textarea>` });
    for (const id of ['q', 't']) {
      const e = pressShortcut(p.window, 'KeyJ', p.$(`#${id}`));
      assert.equal(e.defaultPrevented, false, id);
    }
    assert.equal(p.document.activeElement, p.document.body);
  });

  test('Ctrl や Meta を一緒に押したとき、ほかのキーのときは動かない', async () => {
    const p = await lesson({ attrs: { shortcuts: 'on' } });
    assert.equal(pressShortcut(p.window, 'KeyJ', undefined, { ctrlKey: true }).defaultPrevented, false);
    assert.equal(pressShortcut(p.window, 'KeyJ', undefined, { metaKey: true }).defaultPrevented, false);
    assert.equal(pressShortcut(p.window, 'KeyJ', undefined, { shiftKey: false }).defaultPrevented, false);
    assert.equal(pressShortcut(p.window, 'KeyX').defaultPrevented, false);
  });

  test('data-shortcuts がなければ動かない', async () => {
    const p = await lesson();
    assert.equal(pressShortcut(p.window, 'KeyJ').defaultPrevented, false);
  });
});

describe('自動読み上げ', () => {
  test('data-autoplay="on" なら、開いて少し待ってからあらすじを読む', async () => {
    const started = Date.now();
    const p = await load({ body: DOCS, attrs: { autoplay: 'on' } });
    const text = await nextAnnounce(p.document);
    assert.equal(text, p.api.getRecapText());
    assert.ok(Date.now() - started >= 1000);
  });

  test('既定では読まない', async () => {
    const p = await load({ body: DOCS });
    assert.equal(p.api.getAutoplay(), false);
  });

  test('setAutoplay は namespace ごとに保存し、data 属性より優先する', async () => {
    const p = await load({ body: DOCS, attrs: { namespace: 'ns' } });
    p.api.setAutoplay(true);
    assert.equal(p.api.getAutoplay(), true);
    assert.equal(p.stored('arasuji-settings:ns').autoplay, true);

    const off = await load({ body: DOCS, attrs: { autoplay: 'on' }, storage: { 'arasuji-settings:default': { autoplay: false } } });
    assert.equal(off.api.getAutoplay(), false);
  });

  test('ほかの設定項目は残す', async () => {
    const p = await load({ body: DOCS, storage: { 'arasuji-settings:default': { other: 1 } } });
    p.api.setAutoplay(true);
    assert.equal(p.stored('arasuji-settings:default').other, 1);
  });
});
