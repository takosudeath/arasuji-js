// public/sites.js はブラウザと service worker で読む素の script なので、vm で動かして ARASUJI_SITES を取り出す
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/sites.js', import.meta.url), 'utf8');
const sandbox = {};
vm.runInNewContext(code, { globalThis: sandbox });
const S = sandbox.ARASUJI_SITES;
// vm の中で作られたオブジェクトは deepEqual でプロトタイプが合わないので、こちらの世界に写す
const plain = v => JSON.parse(JSON.stringify(v));

const SOUMU = 'https://www.soumu.go.jp/info-accessibility-portal/';

// querySelector だけを持つ、最小の文書。selectors は「そのセレクタで見つかる要素」の表
function fakeDoc({ selectors = {}, running = false } = {}) {
  return {
    defaultView: null,
    getElementById: id => (id === 'arasuji-live' && running ? {} : null),
    querySelector: sel => selectors[sel] || null,
  };
}

function fakeContainer({ headings, end = null, badSelector = false }) {
  return {
    querySelector: () => {
      if (badSelector) throw new SyntaxError('bad');
      return end;
    },
    querySelectorAll: () => headings,
  };
}

describe('findSite', () => {
  test('URL の前方一致で探す', () => {
    assert.equal(S.findSite(`${SOUMU}about/index.html`).match, SOUMU);
    assert.equal(S.findSite('https://www.soumu.go.jp/other/'), null);
  });
});

describe('configOf', () => {
  test('サイトがなければ空', () => {
    assert.deepEqual(plain(S.configOf(null)), {});
  });

  test('preset を値に開き、サイトの値を優先する', () => {
    const cfg = plain(S.configOf({ config: { preset: 'lesson', heading: 'h3' } }));
    assert.deepEqual(cfg, { ...plain(S.presets.lesson), preset: 'lesson', heading: 'h3' });
  });
});

describe('resolve', () => {
  test('一覧のサイトの設定を使い、空でない上書きだけを当てる', () => {
    const cfg = plain(S.resolve(`${SOUMU}x`, fakeDoc(), { heading: 'h3', end: '' }));
    assert.equal(cfg.container, 'main');
    assert.equal(cfg.heading, 'h3');
    assert.equal(cfg.end, '.m-box--related-info');
    assert.equal(cfg.namespace, 'soumu');
  });

  test('一覧にないサイトでは main → [role="main"] → article の順でコンテナを探す', () => {
    const url = 'https://example.com/';
    assert.equal(S.resolve(url, fakeDoc({ selectors: { article: {}, '[role="main"]': {} } })).container, '[role="main"]');
    assert.equal(S.resolve(url, fakeDoc({ selectors: { article: {} } })).container, 'article');
    assert.equal(S.resolve(url, fakeDoc()).container, 'main');
  });

  test('上書きのコンテナがあれば探さない', () => {
    assert.equal(S.resolve('https://example.com/', fakeDoc({ selectors: { main: {} } }), { container: '#body' }).container, '#body');
  });
});

describe('probe', () => {
  test('節の数を数え、終わりの目印の中の見出しは数えない', () => {
    const inEnd = {};
    const end = { contains: h => h === inEnd };
    const doc = fakeDoc({ selectors: { main: fakeContainer({ headings: [{}, {}, inEnd], end }) } });
    const r = S.probe(`${SOUMU}x`, doc);
    assert.equal(r.matched, true);
    assert.equal(r.headings, 2);
    assert.equal(r.running, false);
    assert.equal(r.depth, 0);
  });

  test('コンテナがなければ 0、セレクタが不正でも 0', () => {
    assert.equal(S.probe('https://example.com/', fakeDoc()).headings, 0);
    const doc = fakeDoc({ selectors: { main: fakeContainer({ headings: [{}], badSelector: true }) } });
    assert.equal(S.probe(`${SOUMU}x`, doc).headings, 0);
  });

  test('すでに動いているかを返す', () => {
    assert.equal(S.probe('https://example.com/', fakeDoc({ running: true })).running, true);
  });

  test('iframe の段数を数える', () => {
    const top = {};
    top.top = top;
    const mid = { parent: top, top };
    const inner = { parent: mid, top };
    const doc = { ...fakeDoc(), defaultView: inner };
    assert.equal(S.probe('https://example.com/', doc).depth, 2);
  });
});

describe('pick', () => {
  const c = (o) => ({ skip: false, matched: false, headings: 1, depth: 0, ...o });

  test('設定済みのサイトで節があるものを最優先にする', () => {
    const matched = c({ matched: true, depth: 1 });
    assert.equal(S.pick([c({ headings: 5 }), matched]), matched);
  });

  test('一覧になければ外側のページを選ぶ', () => {
    const outer = c({ headings: 1 });
    assert.equal(S.pick([c({ depth: 1, headings: 9 }), outer]), outer);
  });

  test('外側に節がなければ、節がいちばん多い iframe（同じなら外側に近いもの）', () => {
    const near = c({ depth: 1, headings: 3 });
    const far = c({ depth: 2, headings: 3 });
    const few = c({ depth: 1, headings: 2 });
    assert.equal(S.pick([c({ headings: 0 }), far, few, near]), near);
  });

  test('skip・節なし・null は除き、候補がなければ null', () => {
    assert.equal(S.pick([null, c({ skip: true, headings: 5 }), c({ headings: 0 })]), null);
    assert.equal(S.pick([]), null);
  });
});
