// ブックマークレットと拡張機能が使う、サイトごとの設定。
// match は URL の前方一致で、上から順に最初に合ったものを使う。
// config は arasuji.js の data 属性と同じ名前（data- を除き、キャメルケース）。
// 拡張機能の service worker でも読むので、window ではなく globalThis に置く
(() => {
  // arasuji.js の PRESETS と同じ値。節を数えるのに値が要るので、ここにも置く。
  // arasuji.js はページに単独で置かれるので1か所にまとめられない。scripts/check-presets.mjs で一致を確かめる
  const PRESETS = {
    lesson: {
      container: '.markdown-section',
      heading: ':scope > h2',
      end: ':scope > .share-button-wrapper',
      accent: 'var(--material-color-main, #2a7ab0)',
    },
  };

  const SITES = [
    {
      name: '総務省 情報アクセシビリティポータルサイト',
      match: 'https://www.soumu.go.jp/info-accessibility-portal/',
      config: { container: 'main', heading: 'h2', end: '.m-box--related-info', namespace: 'soumu' },
    },
  ];

  // 一覧にないサイトでは、本文のコンテナをこの順で探す
  const CONTAINER_CANDIDATES = ['main', '[role="main"]', 'article'];

  function findSite(url) {
    return SITES.find(s => url.startsWith(s.match)) || null;
  }

  // サイトの config。preset は値に開いておく（節を数えるのに使うため）
  function configOf(site) {
    const base = site && site.config ? site.config : {};
    return Object.assign({}, PRESETS[base.preset] || {}, base);
  }

  // override は利用者が手で入れた値（空の項目は無視する）
  function resolve(url, doc, override) {
    const site = findSite(url);
    const cfg = configOf(site);
    for (const [k, v] of Object.entries(override || {})) if (v) cfg[k] = v;
    if (!cfg.container) {
      cfg.container = CONTAINER_CANDIDATES.find(s => doc.querySelector(s)) || 'main';
    }
    if (!cfg.pageId && site && site.pageId) {
      const id = site.pageId(url);
      if (id) cfg.pageId = id;
    }
    return cfg;
  }

  function countHeadings(doc, cfg) {
    try {
      const container = doc.querySelector(cfg.container);
      if (!container) return 0;
      const end = cfg.end ? container.querySelector(cfg.end) : null;
      return [...container.querySelectorAll(cfg.heading || 'h2')].filter(h => !(end && end.contains(h))).length;
    } catch (_) {
      return 0; // セレクタが不正
    }
  }

  // 外側のページからの段数（外側のページは 0）。別オリジンの親でも parent と top はたどれる
  function depthOf(doc) {
    let depth = 0;
    try {
      for (let w = doc.defaultView; w && w !== w.top; w = w.parent) depth++;
    } catch (_) { /* たどれなければ 0 とみなす */ }
    return depth;
  }

  // この文書で使うときの設定と、その設定で見つかる節の数
  function probe(url, doc, override) {
    const running = !!doc.getElementById('arasuji-live');
    const depth = depthOf(doc);
    const site = findSite(url);
    if (site && site.skip) return { skip: true, matched: false, headings: 0, running, depth };
    const cfg = resolve(url, doc, override);
    return { cfg, matched: !!site, headings: countHeadings(doc, cfg), running, depth };
  }

  // 候補（外側のページと iframe）から、arasuji を入れる文書を選ぶ。
  // 設定済みのサイトで節があるもの → 外側のページ → 節がいちばん多い iframe。同じ条件なら外側に近いもの。
  // 一覧にないサイトでは、外側のページに節があれば iframe（広告やコメント欄など）には入れない
  function pick(candidates) {
    const usable = candidates
      .filter(c => c && !c.skip && c.headings > 0)
      .sort((a, b) => a.depth - b.depth);
    return usable.find(c => c.matched) || usable.find(c => c.depth === 0) ||
      usable.reduce((best, c) => (!best || c.headings > best.headings ? c : best), null);
  }

  globalThis.ARASUJI_SITES = { list: SITES, presets: PRESETS, findSite, configOf, resolve, probe, pick };
})();
