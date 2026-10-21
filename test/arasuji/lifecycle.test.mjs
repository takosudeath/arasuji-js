// 動けなかったときの通知（arasuji:unavailable）、止める（destroy）、オン・オフの切り替え（data-optin）
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { load, plain, pressShortcut, LESSON, DOCS } from './load.mjs';

const lesson = (o = {}) => load({ body: LESSON, ...o, attrs: { preset: 'lesson', ...o.attrs } });
const unavailable = p => p.events.filter(e => e.name === 'arasuji:unavailable').map(e => plain(e.detail));
const TOGGLE = '<button id="toggle" type="button">あらすじ機能</button>';

describe('arasuji:unavailable', () => {
  test.each([
    ['コンテナがない', '<div><h2>節</h2></div>', {}, { reason: 'no-container', selector: 'main' }],
    ['見出しがない', '<main><p>本文だけ</p></main>', {}, { reason: 'no-headings', selector: 'h2' }],
    ['セレクタが不正', DOCS, { container: '[[[' }, { reason: 'invalid-selector', selector: '[[[' }],
  ])('%s', async (_, body, attrs, expected) => {
    const p = await load({ body, attrs });
    const [detail] = unavailable(p);
    assert.equal(detail.reason, expected.reason);
    assert.equal(detail.selector, expected.selector);
    assert.equal(typeof detail.message, 'string');
  });

  test('すでに動いていれば already-running', async () => {
    const p = await lesson();
    p.runAgain({ preset: 'lesson' });
    assert.deepEqual(unavailable(p).map(d => d.reason), ['already-running']);
  });

  test('動けたときは出さない', async () => {
    const p = await lesson();
    assert.deepEqual(unavailable(p), []);
  });
});

describe('destroy()', () => {
  test('差し込んだ要素・API・付けた tabindex を外し、arasuji:destroy を出す', async () => {
    const p = await lesson();
    p.api.resume(); // 導入部分に tabindex を付ける
    assert.equal(p.$('#intro').getAttribute('tabindex'), '-1');
    p.api.destroy();
    assert.equal(p.window.Arasuji, undefined);
    assert.equal(p.document.querySelectorAll('[id^="arasuji"], [class*="arasuji-"]').length, 0);
    assert.equal(p.$('#intro').hasAttribute('tabindex'), false);
    assert.equal(p.events.filter(e => e.name === 'arasuji:destroy').length, 1);
  });

  test('ページがもともと持っていた tabindex は残す', async () => {
    const p = await lesson({ body: LESSON.replace('<h2 id="s2">', '<h2 id="s2" tabindex="0">') });
    p.api.markRead(1);
    p.api.resume();
    p.api.destroy();
    assert.equal(p.$('#s2').getAttribute('tabindex'), '0');
  });

  test('止めたあとはフォーカスでもショートカットでも動かない', async () => {
    const p = await lesson({ attrs: { shortcuts: 'on' } });
    p.api.destroy();
    p.$('#a3').focus();
    const e = pressShortcut(p.window, 'KeyR');
    assert.equal(e.defaultPrevented, false);
    assert.equal(p.stored('arasuji:default:page'), null);
  });

  test('止めたあとにもう一度入れても、リスナーは二重にならない', async () => {
    const p = await lesson();
    p.api.destroy();
    p.runAgain({ preset: 'lesson' });
    const changes = () => p.events.filter(e => e.name === 'arasuji:change').length;
    p.$('#a3').focus(); // 3節目 → 2節まで読んだ
    assert.equal(changes(), 1);
    assert.equal(p.$$('.arasuji-recap').length, 1);
    assert.equal(p.$$('#arasuji-style').length, 1);
  });

  test('自動読み上げの予定も取り消す', async () => {
    const p = await lesson({ attrs: { autoplay: 'on' } });
    p.api.destroy();
    await new Promise(r => setTimeout(r, 1800));
    assert.equal(p.events.filter(e => e.name === 'arasuji:announce').length, 0);
  });
});

describe('data-optin', () => {
  const optin = (o = {}) => lesson({ ...o, body: TOGGLE + LESSON, attrs: { optin: '#toggle', ...o.attrs } });

  test('はじめはオフで、何も差し込まない', async () => {
    const p = await optin();
    assert.equal(p.api, undefined);
    assert.equal(p.$('#arasuji-live'), null);
    assert.equal(p.$('#toggle').getAttribute('aria-pressed'), 'false');
  });

  test('押すとオンになって動き、選んだ状態を保存する。もう一度押すと止まる', async () => {
    const p = await optin();
    p.$('#toggle').click();
    assert.equal(p.$('#toggle').getAttribute('aria-pressed'), 'true');
    assert.ok(p.window.Arasuji);
    assert.ok(p.$('.arasuji-recap'));
    assert.equal(p.stored('arasuji-settings:default').enabled, true);

    p.$('#toggle').click();
    assert.equal(p.$('#toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(p.window.Arasuji, undefined);
    assert.equal(p.$('.arasuji-recap'), null);
    assert.equal(p.stored('arasuji-settings:default').enabled, false);
  });

  test('保存した状態がオンなら、開いたときから動く', async () => {
    const p = await optin({ storage: { 'arasuji-settings:default': { enabled: true } } });
    assert.ok(p.api);
    assert.equal(p.$('#toggle').getAttribute('aria-pressed'), 'true');
  });

  test('何度切り替えても、要素もリスナーも1つずつ', async () => {
    const p = await optin();
    for (let i = 0; i < 5; i++) p.$('#toggle').click(); // オンで終わる
    assert.equal(p.$$('#arasuji-live').length, 1);
    assert.equal(p.$$('.arasuji-recap').length, 1);
    p.$('#a3').focus();
    assert.equal(p.events.filter(e => e.name === 'arasuji:change').length, 1);
  });

  test('destroy() で止めると、ボタンもオフの表示になる（保存した状態は変えない）', async () => {
    const p = await optin({ storage: { 'arasuji-settings:default': { enabled: true } } });
    p.window.Arasuji.destroy();
    assert.equal(p.$('#toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(p.stored('arasuji-settings:default').enabled, true);
    p.$('#toggle').click();
    assert.ok(p.window.Arasuji);
  });

  test('自動読み上げの設定と同じ場所に保存し、消し合わない', async () => {
    const p = await optin({ storage: { 'arasuji-settings:default': { autoplay: true } } });
    p.$('#toggle').click();
    assert.deepEqual(p.stored('arasuji-settings:default'), { autoplay: true, enabled: true });
  });

  test('ボタンが見つからなければ知らせて、何もしない', async () => {
    const p = await lesson({ attrs: { optin: '#none' } });
    assert.equal(p.api, undefined);
    assert.deepEqual(unavailable(p).map(d => d.reason), ['no-optin-button']);
  });
});
