// ③ 既定 UI：あらすじ欄、「次の節へ」ボタン、字幕、data-ui="off"
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { load, nextAnnounce, LESSON, DOCS } from './load.mjs';

const lesson = (o = {}) => load({ body: LESSON, ...o, attrs: { preset: 'lesson', ...o.attrs } });
const buttonByText = (p, text) => p.$$('button').find(b => b.textContent === text);

describe('data-ui="off"', () => {
  test('何も差し込まないが、API と通知領域は動く', async () => {
    const p = await lesson({ attrs: { ui: 'off' } });
    assert.equal(p.$('.arasuji-recap'), null);
    assert.equal(p.$('.arasuji-next'), null);
    assert.equal(p.$('#arasuji-style'), null);
    assert.ok(p.$('#arasuji-live'));
    p.api.markRead(1);
    assert.equal(p.api.getState().last, 1);
  });

  test('ページの元の要素は変えない', async () => {
    const p = await lesson({ attrs: { ui: 'off' } });
    const container = p.$('.markdown-section');
    assert.equal(container.querySelectorAll('[class^="arasuji"], [id^="arasuji"]').length, 0);
  });
});

describe('あらすじ欄', () => {
  test('コンテナの h1 の直後に置き、見出しで名前を付ける', async () => {
    const p = await lesson();
    const panel = p.$('#arasuji-recap');
    assert.equal(panel.previousElementSibling, p.$('.markdown-section > h1'));
    const heading = panel.querySelector('.arasuji-recap-heading');
    assert.equal(heading.textContent, '前回のあらすじ');
    assert.equal(panel.getAttribute('aria-labelledby'), heading.id);
    assert.equal(panel.getAttribute('lang'), 'ja');
  });

  test('見出しのレベルは節の見出しにそろえる', async () => {
    const p = await load({ body: '<main><h3>一</h3><h3>二</h3></main>', attrs: { heading: 'h3' } });
    assert.equal(p.$('.arasuji-recap-heading').tagName, 'H3');
  });

  test('節の見出しが h でなければ h2 にする', async () => {
    const p = await load({ body: '<main><p class="t">一</p><p class="t">二</p></main>', attrs: { heading: '.t' } });
    assert.equal(p.$('.arasuji-recap-heading').tagName, 'H2');
  });

  test('h1 がなければコンテナの先頭に置く', async () => {
    const p = await load({ body: '<main><p>前</p><h2>一</h2></main>' });
    assert.equal(p.$('main').firstElementChild, p.$('#arasuji-recap'));
  });

  test('あらすじ文を表示し、進捗が変わったら書き換える', async () => {
    const p = await lesson();
    const text = p.$('.arasuji-recap-text');
    assert.equal(text.textContent, p.api.getRecapText());
    p.api.markRead(2);
    assert.equal(text.textContent, p.api.getRecapText());
    assert.ok(text.textContent.includes('「関数の定義」の節まで'));
  });

  test('ボタンで、あらすじ・続きへ・全体像を呼ぶ', async () => {
    const p = await lesson();
    p.api.markRead(1);

    let done = nextAnnounce(p.document);
    buttonByText(p, 'もう一度聞く').click();
    assert.equal(await done, p.api.getRecapText());

    done = nextAnnounce(p.document);
    buttonByText(p, '全体像を聞く').click();
    assert.equal(await done, p.api.getOverviewText());

    buttonByText(p, '続きから読む').click();
    assert.equal(p.document.activeElement, p.$('#s2'));
  });

  test('ボタンはすべて type="button"（フォームの中でも送信しない）', async () => {
    const p = await lesson();
    assert.ok(p.$$('button[class^="arasuji"]').every(b => b.type === 'button'));
  });

  test('読み上げた文を字幕に出し、欄を光らせる', async () => {
    const p = await lesson();
    const caption = p.$('.arasuji-caption');
    assert.equal(caption.getAttribute('aria-hidden'), 'true');
    const done = nextAnnounce(p.document);
    p.api.announce('テストの文');
    await done;
    assert.equal(caption.textContent, '読み上げ：テストの文');
    assert.ok(p.$('#arasuji-recap').classList.contains('arasuji-flash'));
  });

  test('「進捗を消す」で消して、そのことを読む', async () => {
    const p = await lesson();
    p.api.markRead(2);
    const done = nextAnnounce(p.document);
    buttonByText(p, '進捗を消す').click();
    assert.equal(p.api.getState().last, 0);
    assert.equal(await done, 'このページの進捗を消しました。');
  });

  test('自動読み上げのチェックボックスは設定を映し、変えたら保存する', async () => {
    const p = await lesson({ storage: { 'arasuji-settings:default': { autoplay: true } } });
    const box = p.$('.arasuji-autoplay-input');
    assert.equal(box.checked, true);
    box.click();
    assert.equal(p.api.getAutoplay(), false);
    assert.equal(p.stored('arasuji-settings:default').autoplay, false);
  });

  test('ショートカットが有効なときだけ説明を出す', async () => {
    assert.equal((await lesson()).$('.arasuji-shortcuts'), null);
    assert.ok((await lesson({ attrs: { shortcuts: 'on' } })).$('.arasuji-shortcuts'));
  });

  test('スタイルを1つだけ差し込み、テーマ色を使う', async () => {
    const p = await load({ body: DOCS, attrs: { accent: '#ff0000' } });
    assert.equal(p.$$('#arasuji-style').length, 1);
    assert.ok(p.$('#arasuji-style').textContent.includes('var(--arasuji-accent, #ff0000)'));
  });

  test('色はすべて CSS 変数で上書きでき、既定値は light-dark() でダークモードにも合わせる', async () => {
    const css = (await lesson()).$('#arasuji-style').textContent;
    for (const name of ['accent', 'bg', 'text', 'muted', 'border', 'caption-bg', 'focus', 'on-accent']) {
      assert.ok(css.includes(`var(--arasuji-${name},`), name);
    }
    assert.ok(css.includes('var(--arasuji-bg, light-dark(#fff, '));
    // light-dark() に対応していないブラウザ向けに、明るい色だけの既定値も置く
    assert.ok(css.includes('var(--arasuji-bg, #fff)'));
  });

  test('data-css-layer="on" なら @layer arasuji に入れる', async () => {
    assert.ok(!(await lesson()).$('#arasuji-style').textContent.includes('@layer'));
    const css = (await lesson({ attrs: { 'css-layer': 'on' } })).$('#arasuji-style').textContent;
    assert.ok(css.startsWith('@layer arasuji {'));
  });

  test('data-caption="off" なら字幕を置かず、光らせもしない', async () => {
    const p = await lesson({ attrs: { caption: 'off' } });
    assert.equal(p.$('.arasuji-caption'), null);
    const done = nextAnnounce(p.document);
    p.api.announce('テストの文');
    await done;
    assert.equal(p.$('#arasuji-recap').classList.contains('arasuji-flash'), false);
  });
});

describe('「次の節へ」ボタン', () => {
  test('節ごとに1つ置き、次の節の名前を書く。最後は「読み終える」', async () => {
    const p = await lesson();
    assert.deepEqual(p.$$('.arasuji-next-button').map(b => b.textContent), [
      '次の節へ（関数の定義）',
      '次の節へ（引数と戻り値）',
      'このページを読み終える',
    ]);
  });

  test('教材風のページでは次の見出しの直前、最後は終わりの目印の直前に置く', async () => {
    const p = await lesson();
    const wraps = p.$$('.arasuji-next');
    assert.equal(wraps[0].nextElementSibling, p.$('#s2'));
    assert.equal(wraps[1].nextElementSibling, p.$('#s3'));
    assert.equal(wraps[2].nextElementSibling, p.$('.share-button-wrapper'));
  });

  test('節を <section> で囲んだページでは、その <section> の末尾に置く', async () => {
    const p = await load({ body: DOCS });
    for (const id of ['sec1', 'sec2', 'sec3']) {
      assert.ok(p.$(`#${id}`).lastElementChild.classList.contains('arasuji-next'), id);
    }
  });

  test('終わりの目印がなく、平らな構造なら、最後はコンテナの末尾', async () => {
    const p = await load({ body: '<main><h2>一</h2><p>本文</p><h2>二</h2><p>本文</p></main>' });
    assert.ok(p.$('main').lastElementChild.classList.contains('arasuji-next'));
  });

  test('押すとその節まで読んだことにして、次の節の見出しへ移る', async () => {
    const p = await lesson();
    p.$$('.arasuji-next-button')[0].click();
    assert.equal(p.api.getState().last, 1);
    assert.equal(p.document.activeElement, p.$('#s2'));
  });

  test('最後のボタンは読み終えたことにして、フォーカスを動かさずに知らせる', async () => {
    const p = await lesson();
    const last = p.$$('.arasuji-next-button')[2];
    last.focus();
    const done = nextAnnounce(p.document);
    last.click();
    assert.equal(p.api.getState().last, 3);
    assert.equal(p.document.activeElement, last);
    assert.equal(await done, 'このページを読み終えました。');
  });

  test('フォーカスが来ただけで、その節まで読んだことにする', async () => {
    const p = await lesson();
    p.$$('.arasuji-next-button')[1].focus();
    assert.equal(p.api.getState().last, 2);
  });

  test('あらすじ欄にフォーカスが来ても進捗は変えない', async () => {
    const p = await lesson();
    buttonByText(p, 'もう一度聞く').focus();
    assert.equal(p.api.getState().last, 0);
  });
});
