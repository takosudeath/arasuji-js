// ① コア：起動、設定の解決、節の検出、進捗、あらすじ文・全体像の文、要約データ
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { load, plain, LESSON, DOCS } from './load.mjs';

const lesson = (o = {}) => load({ body: LESSON, ...o, attrs: { preset: 'lesson', ...o.attrs } });
const DAY = 24 * 60 * 60 * 1000;

describe('起動', () => {
  test('準備ができたら window.Arasuji を置き、arasuji:ready と ready で状態を渡す', async () => {
    const p = await lesson();
    assert.equal(typeof p.api.getState, 'function');
    const ready = p.events.filter(e => e.name === 'arasuji:ready');
    assert.equal(ready.length, 1);
    assert.equal(ready[0].detail.pageId, 'page');
    assert.deepEqual(await p.api.ready, ready[0].detail);
  });

  test('コンテナがなければ何もしない（API もイベントも通知領域も置かない）', async () => {
    const p = await load({ body: '<div><h2>節</h2></div>' });
    assert.equal(p.api, undefined);
    assert.equal(p.events.length, 0);
    assert.equal(p.$('#arasuji-live'), null);
    assert.ok(p.logs.some(l => l.level === 'warn' && l.text.includes('コンテナが見つかりません')));
  });

  test('見出しがなければ何もしない', async () => {
    const p = await load({ body: '<main><p>本文だけ</p></main>' });
    assert.equal(p.api, undefined);
    assert.ok(p.logs.some(l => l.level === 'warn' && l.text.includes('節の見出しが見つかりません')));
  });

  test('セレクタが不正なら警告して何もしない', async () => {
    const p1 = await load({ body: DOCS, attrs: { container: '[[[' } });
    assert.equal(p1.api, undefined);
    assert.ok(p1.logs.some(l => l.text.includes('data-container のセレクタが不正です')));

    const p2 = await load({ body: DOCS, attrs: { heading: 'h2:::' } });
    assert.equal(p2.api, undefined);
    assert.ok(p2.logs.some(l => l.text.includes('data-heading / data-end のセレクタが不正です')));
  });

  test('すでに動いているページでは、もう一度入れても二重に動かない', async () => {
    const p = await lesson();
    const first = p.api;
    p.runAgain({ preset: 'lesson' });
    assert.equal(p.window.Arasuji, first);
    assert.equal(p.$$('#arasuji-live').length, 1);
    assert.equal(p.$$('.arasuji-recap').length, 1);
    assert.equal(p.events.filter(e => e.name === 'arasuji:ready').length, 1);
    assert.ok(p.logs.some(l => l.level === 'info' && l.text.includes('すでに動いています')));
  });

  test('script 要素がなくても window.ARASUJI_CONFIG で動く（拡張機能）。true / false は on / off として扱う', async () => {
    const p = await load({ body: DOCS, config: { container: 'main', heading: 'h2', ui: false, shortcuts: true } });
    assert.equal(p.api.getState().sections.length, 3);
    assert.equal(p.$('.arasuji-recap'), null);
  });

  test('script 要素も ARASUJI_CONFIG もなければ何もしない', async () => {
    const p = await load({ body: DOCS, config: undefined, setup: w => { w.ARASUJI_CONFIG = undefined; } });
    p.window.eval('delete window.Arasuji');
    p.runAgain(undefined);
    assert.equal(p.window.Arasuji, undefined);
  });
});

describe('設定の解決', () => {
  test.each([
    ['/lesson/py-func.html', 'py-func'],
    ['/lesson/py-func', 'py-func'],
    ['/lesson/PAGE.HTM', 'PAGE'],
    ['/docs/', 'docs'],
    ['/docs/index.html', 'docs'],
    ['/', 'index'],
    ['/a/%E9%96%A2%E6%95%B0.html', '関数'],
    ['/a/%E0%A4%A.html', '%E0%A4%A'],
  ])('URL %s のページ ID は %s', async (pathname, id) => {
    const p = await load({ body: DOCS, url: `https://example.com${pathname}` });
    assert.equal(p.api.getState().pageId, id);
  });

  test('data-page-id があれば URL より優先する', async () => {
    const p = await load({ body: DOCS, attrs: { 'page-id': 'custom' } });
    assert.equal(p.api.getState().pageId, 'custom');
  });

  test('既定は main の中の h2', async () => {
    const p = await load({ body: DOCS });
    assert.deepEqual(plain(p.api.getState().sections.map(s => s.heading)), ['インストール', '設定', '公開']);
  });

  test('lesson プリセットは直下の h2 だけを節にし、共有欄から後ろは除く', async () => {
    const body = LESSON.replace('<p id="p2">', '<div><h2>入れ子の見出し</h2></div><p id="p2">');
    const p = await lesson({ body });
    assert.deepEqual(plain(p.api.getState().sections.map(s => s.heading)), ['関数とは', '関数の定義', '引数と戻り値']);
  });

  test('data 属性はプリセットより優先する', async () => {
    const body = LESSON.replace('<h2 id="s2">関数の定義</h2>', '<h3>小節</h3><h2 id="s2">関数の定義</h2>');
    const p = await lesson({ body, attrs: { heading: ':scope > h3' } });
    assert.deepEqual(plain(p.api.getState().sections.map(s => s.heading)), ['小節']);
  });

  test('data-end の中の見出しは節にしない', async () => {
    const body = '<main><h2>一</h2><h2>二</h2><footer class="related"><h2>関連</h2></footer></main>';
    const withEnd = await load({ body, attrs: { end: '.related' } });
    assert.equal(withEnd.api.getState().sections.length, 2);
    const without = await load({ body });
    assert.equal(without.api.getState().sections.length, 3);
  });

  test('見出しの文字の空白を詰める', async () => {
    const p = await load({ body: '<main><h2>  関数\n   の  <b>定義</b> </h2></main>' });
    assert.equal(p.api.getState().sections[0].heading, '関数 の 定義');
  });
});

describe('進捗', () => {
  test('はじめは未着手', async () => {
    const p = await lesson();
    const s = p.api.getState();
    assert.equal(s.last, 0);
    assert.equal(s.next, 1);
    assert.equal(s.updatedAt, null);
    assert.ok(s.sections.every(x => !x.read));
  });

  test('markRead で進め、localStorage に保存し、arasuji:change を出す', async () => {
    const p = await lesson();
    const before = Date.now();
    p.api.markRead(2);
    const s = p.api.getState();
    assert.equal(s.last, 2);
    assert.equal(s.next, 3);
    assert.deepEqual(plain(s.sections.map(x => x.read)), [true, true, false]);
    assert.ok(s.updatedAt >= before);
    assert.deepEqual(p.stored('arasuji:default:page'), { last: 2, updatedAt: s.updatedAt });
    const changes = p.events.filter(e => e.name === 'arasuji:change');
    assert.equal(changes.length, 1);
    assert.equal(changes[0].detail.last, 2);
  });

  test('一番先まで読んだ位置を残す（戻っても減らさず、通知もしない）', async () => {
    const p = await lesson();
    p.api.markRead(3);
    const { updatedAt } = p.api.getState();
    p.api.markRead(1);
    p.api.markRead(3);
    assert.equal(p.api.getState().last, 3);
    assert.equal(p.api.getState().updatedAt, updatedAt);
    assert.equal(p.events.filter(e => e.name === 'arasuji:change').length, 1);
  });

  test('節の数の範囲に収める', async () => {
    const p = await lesson();
    p.api.markRead(0);
    assert.equal(p.api.getState().last, 1);
    p.api.markRead(99);
    assert.equal(p.api.getState().last, 3);
    assert.equal(p.api.getState().next, null);
  });

  test('reset で消す', async () => {
    const p = await lesson();
    p.api.markRead(2);
    p.api.reset();
    assert.equal(p.api.getState().last, 0);
    assert.equal(p.api.getState().updatedAt, null);
    assert.equal(p.stored('arasuji:default:page'), null);
    assert.equal(p.events.filter(e => e.name === 'arasuji:change').length, 2);
  });

  test('setProgress は減らす向きにも上書きする', async () => {
    const p = await lesson();
    p.api.markRead(3);
    p.api.setProgress(1, 2);
    const s = p.api.getState();
    assert.equal(s.last, 1);
    assert.ok(Math.abs(Date.now() - 2 * DAY - s.updatedAt) < 1000);
    p.api.setProgress(0);
    assert.equal(p.stored('arasuji:default:page'), null);
  });

  test('保存した進捗を読み戻す（多すぎる値は節の数に収める）', async () => {
    const p1 = await lesson({ storage: { 'arasuji:default:page': { last: 2, updatedAt: 123 } } });
    assert.equal(p1.api.getState().last, 2);
    assert.equal(p1.api.getState().updatedAt, 123);

    const p2 = await lesson({ storage: { 'arasuji:default:page': { last: 10, updatedAt: 123 } } });
    assert.equal(p2.api.getState().last, 3);
  });

  test('壊れた保存値は未着手として扱う', async () => {
    for (const saved of [{ last: '2' }, { last: -1 }, 'x', null]) {
      const p = await lesson({ storage: { 'arasuji:default:page': saved } });
      assert.equal(p.api.getState().last, 0, JSON.stringify(saved));
    }
  });

  test('namespace とページ ID ごとに分けて保存する', async () => {
    const p = await lesson({ attrs: { namespace: 'site-a', 'page-id': 'p1' } });
    p.api.markRead(1);
    assert.equal(p.stored('arasuji:site-a:p1').last, 1);
    assert.equal(p.stored('arasuji:default:page'), null);
  });

  test('localStorage が使えなくても、メモリに持って動く', async () => {
    const p = await lesson({
      setup: w => {
        Object.defineProperty(w, 'localStorage', { get() { throw new Error('SecurityError'); } });
      },
    });
    p.api.markRead(2);
    assert.equal(p.api.getState().last, 2);
    p.api.reset();
    assert.equal(p.api.getState().last, 0);
  });
});

describe('フォーカスで進捗を記録する', () => {
  test('ある節の中にフォーカスが来たら、その前の節まで読んだことにする', async () => {
    const p = await lesson({ attrs: { ui: 'off' } });
    p.$('#a3').focus();
    assert.equal(p.api.getState().last, 2);
  });

  test('導入部分と1節目では記録しない', async () => {
    const p = await lesson({ attrs: { ui: 'off' } });
    p.$('#a0').focus();
    p.$('#a1').focus();
    assert.equal(p.api.getState().last, 0);
  });

  test('終わりの目印の中に来たら、最後まで読んだことにする', async () => {
    const p = await lesson({ attrs: { ui: 'off' } });
    p.$('#share').focus();
    assert.equal(p.api.getState().last, 3);
  });

  test('節を <section> で囲んだページでも同じように数える', async () => {
    const body = DOCS.replace('<p>本文3</p>', '<p><a id="d3" href="#">リンク</a></p>');
    const p = await load({ body, attrs: { ui: 'off' } });
    p.$('#d3').focus();
    assert.equal(p.api.getState().last, 2);
  });

  test('arasuji- で始まるクラスの要素（UI の部品）にフォーカスが来ても記録しない', async () => {
    const body = LESSON.replace('<a id="a3" href="#">リンク</a>', '<span class="arasuji-custom"><button id="ui">操作</button></span>');
    const p = await lesson({ attrs: { ui: 'off' }, body });
    p.$('#ui').focus();
    assert.equal(p.api.getState().last, 0);
  });

  test('コンテナの外は記録しない', async () => {
    const p = await lesson({ attrs: { ui: 'off' }, body: `${LESSON}<a id="outside" href="#">外</a>` });
    p.$('#outside').focus();
    assert.equal(p.api.getState().last, 0);
  });
});

describe('あらすじ文', () => {
  const DATA = {
    page: {
      title: 'データの題',
      sections: [
        { order: 1, heading: '関数とは', summary: '関数の考え方を学ぶ。' },
        { order: 2, heading: '関数の定義', summary: 'def で関数を作る。' },
        { order: 3, heading: '引数と戻り値', summary: '値を渡して受け取る。' },
      ],
      points: { 1: '関数は処理に名前を付けたもの', 2: 'def で定義して呼び出す。', 3: '' },
    },
  };

  test('未着手', async () => {
    const p = await lesson();
    assert.equal(p.api.getRecapText(), '「関数の教材」はまだ始めていません。最初の節は「関数とは」です。全3節です。');
  });

  test('途中（どこまで → 続き → 要点 → 残り）。要点に句点がなければ足す', async () => {
    const p = await lesson({ data: DATA });
    p.api.markRead(1);
    assert.equal(p.api.getRecapText(),
      '今日は「関数とは」の節まで進みました。続きは「関数の定義」からです。関数は処理に名前を付けたもの。残り2節です。');
    p.api.markRead(2);
    assert.equal(p.api.getRecapText(),
      '今日は「関数の定義」の節まで進みました。続きは「引数と戻り値」からです。def で定義して呼び出す。残り1節です。');
  });

  test('要約データがなければ要点を省く', async () => {
    const p = await lesson();
    p.api.markRead(1);
    assert.equal(p.api.getRecapText(), '今日は「関数とは」の節まで進みました。続きは「関数の定義」からです。残り2節です。');
  });

  test('読み終えたとき', async () => {
    const p = await lesson();
    p.api.markRead(3);
    assert.equal(p.api.getRecapText(), '今日は最後の節「引数と戻り値」まで進みました。このページは最後まで読み終えています。');
  });

  test.each([
    [0, '今日は'],
    [1, '前回は昨日、'],
    [3, '前回は3日前、'],
  ])('%i 日前なら「%s」で始める', async (daysAgo, prefix) => {
    const p = await lesson();
    p.api.setProgress(1, daysAgo);
    assert.ok(p.api.getRecapText().startsWith(`${prefix}「関数とは」`), p.api.getRecapText());
  });

  test('題は要約データ → コンテナの h1 → document.title の順に取る', async () => {
    const withData = await lesson({ data: DATA });
    assert.ok(withData.api.getRecapText().startsWith('「データの題」'));
    const withH1 = await lesson();
    assert.ok(withH1.api.getRecapText().startsWith('「関数の教材」'));
    const withTitle = await load({ body: '<main><h2>節</h2></main>', title: 'タブの題' });
    assert.ok(withTitle.api.getRecapText().startsWith('「タブの題」'));
  });

  test('要約データが後から読み込まれても使う', async () => {
    const p = await lesson();
    p.window.ARASUJI_DATA = DATA;
    p.api.markRead(1);
    assert.ok(p.api.getRecapText().includes('関数は処理に名前を付けたもの。'));
    assert.equal(p.api.getState().sections[0].summary, '関数の考え方を学ぶ。');
  });

  test('ほかのページの要約データは使わない', async () => {
    const p = await lesson({ data: { other: DATA.page } });
    assert.equal(p.api.getState().title, '関数の教材');
    assert.equal(p.api.getState().sections[0].summary, null);
  });

  test('要約データとページで節の数が違えば警告する', async () => {
    const data = { page: { ...DATA.page, sections: DATA.page.sections.slice(0, 2) } };
    const p = await lesson({ data });
    assert.ok(p.logs.some(l => l.level === 'warn' && l.text.includes('節数（2）とページの見出し数（3）が合いません')));
  });
});

describe('全体像の文', () => {
  test('既読・未読と、どこから読むかを並べる', async () => {
    const p = await lesson();
    p.api.markRead(1);
    assert.equal(p.api.getOverviewText(),
      '「関数の教材」は全3節、既読1節です。1、関数とは、既読。2、関数の定義、未読、ここから。3、引数と戻り値、未読。');
  });

  test('未着手なら1節目から', async () => {
    const p = await lesson();
    assert.ok(p.api.getOverviewText().includes('既読0節です。1、関数とは、未読、ここから。'));
  });
});

describe('デモ用の URL', () => {
  test.each([
    ['3days', 2, '前回は3日前、'],
    ['today', 2, '今日は'],
    ['reset', 0, '「関数の教材」はまだ始めていません'],
  ])('?demo=%s', async (demo, last, prefix) => {
    const p = await lesson({
      attrs: { demo: 'on' },
      url: `https://example.com/lesson/page.html?demo=${demo}&x=1#s2`,
      storage: { 'arasuji:default:page': { last: 3, updatedAt: Date.now() } },
    });
    assert.equal(p.api.getState().last, last);
    assert.ok(p.api.getRecapText().startsWith(prefix));
    assert.equal(p.window.location.search, '?x=1');
    assert.equal(p.window.location.hash, '#s2');
    // 読み込み時の設定は通知しない
    assert.equal(p.events.filter(e => e.name === 'arasuji:change').length, 0);
  });

  test('data-demo が off なら URL を見ない', async () => {
    const p = await lesson({ url: 'https://example.com/lesson/page.html?demo=3days' });
    assert.equal(p.api.getState().last, 0);
    assert.equal(p.window.location.search, '?demo=3days');
  });

  test('知らない値は何もしない', async () => {
    const p = await lesson({ attrs: { demo: 'on' }, url: 'https://example.com/lesson/page.html?demo=xxx' });
    assert.equal(p.api.getState().last, 0);
    assert.equal(p.window.location.search, '?demo=xxx');
  });
});
