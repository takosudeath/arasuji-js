/*! arasuji.js — 中断した長文ページを再開するときに「前回のあらすじ」を聞けるようにする */
(() => {
  'use strict';

  const script = document.currentScript; // defer でも実行中は値が入っている。ハンドラの中では null になる
  // script 要素を通らずに動くとき（拡張の content script など）は window.ARASUJI_CONFIG から設定を受け取る
  const source = script ? script.dataset : window.ARASUJI_CONFIG;
  if (!source) return;

  const PRESETS = {
    lesson: {
      container: '.markdown-section',
      heading: ':scope > h2',
      end: ':scope > .share-button-wrapper',
      accent: 'var(--material-color-main, #2a7ab0)',
    },
  };

  const DAY = 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------------------
  // 共通

  function resolveConfig(ds) {
    const preset = PRESETS[ds.preset] || {};
    const pick = (key, fallback) => {
      let v = ds[key];
      if (v === true) v = 'on'; // ARASUJI_CONFIG では true / false も受け付ける
      if (v === false) v = 'off';
      return v != null && v !== '' ? String(v) : preset[key] != null ? preset[key] : fallback;
    };
    return {
      container: pick('container', 'main'),
      heading: pick('heading', 'h2'),
      end: pick('end', null),
      pageId: pick('pageId', null) || pageIdFromUrl(location.pathname),
      namespace: pick('namespace', 'default'),
      demo: pick('demo', 'off'),
      shortcuts: pick('shortcuts', 'off'),
      autoplay: pick('autoplay', 'off'),
      ui: pick('ui', 'on'),
      accent: pick('accent', '#2a7ab0'),
    };
  }

  // /lesson/py-func.html と /lesson/py-func はどちらも py-func。
  // 末尾が / のときと index のときは、一つ上のディレクトリ名（/docs/ と /docs/index.html はどちらも docs）。/ だけなら index
  function pageIdFromUrl(pathname) {
    const parts = pathname.split('/').map(p => {
      try { return decodeURIComponent(p); } catch (_) { return p; } // そのまま使う
    });
    let name = (parts.pop() || '').replace(/\.html?$/i, '');
    if (name === '' || name === 'index') name = parts.filter(Boolean).pop() || 'index';
    return name;
  }

  // ページの構造を読むだけで、書き換えない。③も同じ関数で見出しを探す
  function findSections(cfg) {
    let container;
    try { container = document.querySelector(cfg.container); } catch (e) {
      console.warn('[arasuji] data-container のセレクタが不正です:', cfg.container);
      return null;
    }
    if (!container) return null;
    let endMarker = null;
    let headings = [];
    try {
      endMarker = cfg.end ? container.querySelector(cfg.end) : null;
      headings = [...container.querySelectorAll(cfg.heading)]
        .filter(h => !(endMarker && endMarker.contains(h)));
    } catch (e) {
      console.warn('[arasuji] data-heading / data-end のセレクタが不正です:', cfg.heading, cfg.end);
      return null;
    }
    return { container, endMarker, headings };
  }

  function normalizeText(s) {
    return (s || '').trim().replace(/\s+/g, ' ');
  }

  function withPeriod(s) {
    s = (s || '').trim();
    if (!s) return '';
    return /[。．.！!？?]$/.test(s) ? s : s + '。';
  }

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // localStorage が使えなければメモリに持つ
  function createStore() {
    const memory = new Map();
    return {
      get(key) {
        try {
          const raw = localStorage.getItem(key);
          return raw == null ? null : JSON.parse(raw);
        } catch (_) {
          return memory.has(key) ? memory.get(key) : null;
        }
      },
      set(key, value) {
        memory.set(key, value);
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* メモリだけに持つ */ }
      },
      remove(key) {
        memory.delete(key);
        try { localStorage.removeItem(key); } catch (_) { /* メモリだけ消す */ }
      },
    };
  }

  // 端末のローカル時刻での日付の差
  function daysBetween(from, to) {
    const a = new Date(from); a.setHours(0, 0, 0, 0);
    const b = new Date(to); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / DAY); // 夏時間で23・25時間の日があるので丸める
  }

  function hasArasujiClass(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      for (const c of node.classList) if (c.startsWith('arasuji-')) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // ① コア

  function createCore(cfg, store) {
    const found = findSections(cfg);
    if (!found) {
      console.warn('[arasuji] 本文のコンテナが見つかりません:', cfg.container);
      return null;
    }
    const { container, endMarker, headings } = found;
    if (headings.length === 0) {
      console.warn('[arasuji] 節の見出しが見つかりません:', cfg.heading);
      return null;
    }

    const total = headings.length;
    const pageId = cfg.pageId;
    const key = `arasuji:${cfg.namespace}:${pageId}`;
    const headingTexts = headings.map(h => normalizeText(h.textContent));

    // データは参照のたびに引く（データファイルが後から読み込まれても拾えるように）
    const getData = () => (window.ARASUJI_DATA || {})[pageId] || null;

    const initialData = getData();
    if (initialData && Array.isArray(initialData.sections) && initialData.sections.length !== total) {
      console.warn(`[arasuji] 要約データの節数（${initialData.sections.length}）とページの見出し数（${total}）が合いません: ${pageId}`);
    }

    const clamp = n => Math.min(total, Math.max(0, Math.floor(Number(n) || 0)));

    let progress = loadProgress();

    function loadProgress() {
      const saved = store.get(key);
      if (saved && typeof saved.last === 'number' && saved.last > 0) {
        return { last: clamp(saved.last), updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : Date.now() };
      }
      return { last: 0, updatedAt: null };
    }

    function save(next, notify) {
      progress = next;
      if (next.last > 0) store.set(key, next);
      else store.remove(key);
      if (notify) emit('arasuji:change', getState());
    }

    function getTitle() {
      const data = getData();
      if (data && data.title) return normalizeText(data.title);
      const h1 = container.querySelector('h1');
      if (h1 && normalizeText(h1.textContent)) return normalizeText(h1.textContent);
      return normalizeText(document.title);
    }

    function getSummary(order) {
      const data = getData();
      const s = data && Array.isArray(data.sections) ? data.sections.find(x => Number(x.order) === order) : null;
      return s && s.summary ? s.summary : null;
    }

    function getPoint(last) {
      const data = getData();
      const p = data && data.points ? data.points[String(last)] : null;
      return p ? withPeriod(p) : '';
    }

    function getState() {
      const { last, updatedAt } = progress;
      return {
        pageId,
        title: getTitle(),
        sections: headingTexts.map((heading, i) => ({
          order: i + 1,
          heading,
          summary: getSummary(i + 1),
          read: i + 1 <= last,
        })),
        last,
        updatedAt,
        next: last < total ? last + 1 : null,
      };
    }

    // 「前回は3日前、」「前回は昨日、」「今日は」
    function whenPrefix(updatedAt) {
      const days = daysBetween(updatedAt, Date.now());
      if (days <= 0) return '今日は';
      if (days === 1) return '前回は昨日、';
      return `前回は${days}日前、`;
    }

    // 呼ぶたびにその時点の進捗で組み立て直す。大事な順（どこまで → 続き → 要点 → 残り）
    function getRecapText() {
      const { last, updatedAt } = progress;
      const title = getTitle();
      if (last === 0) {
        return `「${title}」はまだ始めていません。最初の節は「${headingTexts[0]}」です。全${total}節です。`;
      }
      const when = whenPrefix(updatedAt);
      if (last >= total) {
        return `${when}最後の節「${headingTexts[total - 1]}」まで進みました。このページは最後まで読み終えています。`;
      }
      return `${when}「${headingTexts[last - 1]}」の節まで進みました。` +
        `続きは「${headingTexts[last]}」からです。` +
        getPoint(last) +
        `残り${total - last}節です。`;
    }

    function getOverviewText() {
      const { last } = progress;
      const items = headingTexts.map((h, i) => {
        const order = i + 1;
        if (order <= last) return `${order}、${h}、既読。`;
        if (order === last + 1) return `${order}、${h}、未読、ここから。`;
        return `${order}、${h}、未読。`;
      });
      return `「${getTitle()}」は全${total}節、既読${last}節です。` + items.join('');
    }

    // 一番先まで読んだ位置を残す。updatedAt は last が増えたときだけ更新する
    function markRead(n) {
      const value = Math.max(1, clamp(n));
      if (value <= progress.last) return;
      save({ last: value, updatedAt: Date.now() }, true);
    }

    function reset() {
      save({ last: 0, updatedAt: null }, true);
    }

    // デモ用。大きいほうを残さず、そのまま上書きする
    function setProgress(last, daysAgo = 0, notify = true) {
      const value = clamp(last);
      const updatedAt = value > 0 ? Date.now() - Math.max(0, Number(daysAgo) || 0) * DAY : null;
      save({ last: value, updatedAt }, notify);
    }

    // 要素がどの節にあるか（入れ子でも平らでも同じ式で動く。見出しそのものと見出しの中も含める）
    function sectionOf(el) {
      return headings.filter(h =>
        h === el || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
      ).length;
    }

    document.addEventListener('focusin', e => {
      const el = e.target;
      if (!(el instanceof Element) || !container.contains(el)) return;
      if (hasArasujiClass(el)) return; // ③の要素は markRead で別に記録される
      if (endMarker && endMarker.contains(el)) {
        markRead(total);
        return;
      }
      const n = sectionOf(el);
      if (n >= 2) markRead(n - 1); // 導入部分と1節目は記録しない
    });

    if (cfg.demo === 'on') applyDemoParam();

    function applyDemoParam() {
      let url;
      try { url = new URL(location.href); } catch (_) { return; }
      const demo = url.searchParams.get('demo');
      if (!demo) return;
      if (demo === '3days') setProgress(2, 3, false);
      else if (demo === 'today') setProgress(2, 0, false);
      else if (demo === 'reset') setProgress(0, 0, false);
      else return;
      url.searchParams.delete('demo');
      try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch (_) { /* file:// など */ }
    }

    return {
      container,
      headings,
      api: { getState, getRecapText, getOverviewText, markRead, reset, setProgress: (last, daysAgo) => setProgress(last, daysAgo, true) },
    };
  }

  // ---------------------------------------------------------------------------
  // ② 読み上げ・フォーカス

  function createVoice(core, cfg, store) {
    const { api } = core;
    const settingsKey = `arasuji-settings:${cfg.namespace}`;

    // 初期化時に置く（後から置くと読まれないことがある）。③の CSS に頼らず、ここで視覚的に隠す
    const live = document.createElement('div');
    live.id = 'arasuji-live';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    live.setAttribute('lang', 'ja');
    Object.assign(live.style, {
      position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0',
      overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: '0',
    });
    document.body.appendChild(live);

    let timer;
    let alternate = false;
    function announce(text) {
      clearTimeout(timer);
      live.textContent = ''; // 同じ文でも読ませるため一度空にする
      timer = setTimeout(() => {
        // 空にしても、直前と同じ文は読まない環境（VoiceOver など）がある。
        // 毎回新しい要素として入れ、末尾の空白を交互に付けて、直前の文と同じにならないようにする
        const item = document.createElement('p');
        item.style.margin = '0';
        alternate = !alternate;
        item.textContent = alternate ? text : text + ' ';
        live.replaceChildren(item);
        emit('arasuji:announce', { text });
      }, 150);
    }

    const recap = () => announce(api.getRecapText());
    const overview = () => announce(api.getOverviewText());

    // フォーカスを動かすのはこの操作のときだけ
    function resume() {
      const { last, next, sections } = api.getState();
      // 未着手なら、最初の見出しより前の導入部分から読めるようにする
      const target = (last === 0 && findIntro(core.container, core.headings[0])) ||
        core.headings[(next || sections.length) - 1];
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
    }

    // h1（ページ名）より後ろ、最初の見出しより前にある、文字を含む最初の要素。
    // h1 より前のパンくずなどは導入部分ではない。h1 そのものと③の要素も飛ばす
    function findIntro(container, firstHeading) {
      const h1 = container.querySelector('h1');
      let passed = !(h1 && h1.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
      // 見つけたら要素、最初の見出しに着いたら null、どちらでもなければ undefined を返す
      function walk(parent) {
        for (const child of parent.children) {
          if (child === firstHeading) return null;
          if (child === h1) { passed = true; continue; }
          if (child.contains(firstHeading) || (h1 && child.contains(h1))) {
            const found = walk(child);
            if (found !== undefined) return found;
            continue;
          }
          if (!passed || hasArasujiClass(child)) continue;
          if (/^(SCRIPT|STYLE|TEMPLATE)$/.test(child.tagName) || child.hidden) continue;
          if (!normalizeText(child.textContent)) continue;
          return child;
        }
        return undefined;
      }
      return walk(container) || null;
    }

    function getAutoplay() {
      const s = store.get(settingsKey);
      if (s && typeof s.autoplay === 'boolean') return s.autoplay;
      return cfg.autoplay === 'on';
    }

    function setAutoplay(on) {
      const s = store.get(settingsKey);
      store.set(settingsKey, Object.assign({}, s && typeof s === 'object' ? s : {}, { autoplay: !!on }));
    }

    if (cfg.shortcuts === 'on') {
      const actions = { KeyR: recap, KeyJ: resume, KeyO: overview };
      document.addEventListener('keydown', e => {
        // Alt+Shift を押していると e.key が変わるので e.code で判定する
        if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
        const action = actions[e.code];
        if (!action || isEditable(e.target)) return;
        e.preventDefault();
        action();
      });
    }

    if (getAutoplay()) setTimeout(recap, 1500); // 直後の通知は取りこぼされやすい

    return { api: { announce, recap, overview, resume, setAutoplay, getAutoplay } };
  }

  function isEditable(el) {
    if (!(el instanceof Element)) return false;
    if (el.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  // ---------------------------------------------------------------------------
  // ③ 既定 UI（公開 API とイベントだけを使う）

  function createDefaultUI(api, cfg) {
    const found = findSections(cfg);
    if (!found) return;
    const { container, endMarker, headings } = found;

    injectStyle(cfg);

    const make = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.setAttribute('lang', 'ja');
      if (text != null) el.textContent = text;
      return el;
    };
    const button = (className, text, onClick) => {
      const b = make('button', className, text);
      b.type = 'button';
      b.addEventListener('click', onClick);
      return b;
    };

    // --- あらすじ欄
    const level = /^H[1-6]$/.test(headings[0].tagName) ? headings[0].tagName.toLowerCase() : 'h2';
    const panel = make('section', 'arasuji-recap');
    panel.id = 'arasuji-recap';
    const heading = make(level, 'arasuji-recap-heading', '前回のあらすじ');
    heading.id = 'arasuji-recap-heading';
    panel.setAttribute('aria-labelledby', heading.id);

    const text = make('p', 'arasuji-recap-text', api.getRecapText());

    const actions = make('div', 'arasuji-actions');
    actions.append(
      button('arasuji-button', 'もう一度聞く', () => api.recap()),
      button('arasuji-button arasuji-button-primary', '続きから読む', () => api.resume()),
      button('arasuji-button', '全体像を聞く', () => api.overview()),
    );

    const caption = make('p', 'arasuji-caption');
    caption.setAttribute('aria-hidden', 'true');

    const options = make('div', 'arasuji-options');
    const autoplayLabel = make('label', 'arasuji-autoplay');
    const autoplay = make('input', 'arasuji-autoplay-input');
    autoplay.type = 'checkbox';
    autoplay.checked = api.getAutoplay();
    autoplay.addEventListener('change', () => api.setAutoplay(autoplay.checked));
    autoplayLabel.append(autoplay, document.createTextNode('開いたときに自動で読み上げる'));
    options.append(autoplayLabel);

    if (cfg.shortcuts === 'on') {
      options.append(make('p', 'arasuji-shortcuts',
        'ショートカット：Alt（Option）+Shift+R であらすじ、+J で続きへ、+O で全体像'));
    }

    // 押し間違えないよう、ほかのボタンと離して控えめに置く
    const resetButton = button('arasuji-reset', '進捗を消す', () => {
      api.reset();
      api.announce('このページの進捗を消しました。');
    });
    options.append(resetButton);

    panel.append(heading, text, actions, caption, options);

    const h1 = container.querySelector('h1');
    if (h1) h1.after(panel);
    else container.prepend(panel);

    // --- 「次の節へ」ボタン
    const total = headings.length;
    headings.forEach((h, i) => {
      const order = i + 1;
      const isLast = order === total;
      const label = isLast ? 'このページを読み終える' : `次の節へ（${normalizeText(headings[i + 1].textContent)}）`;
      const wrap = make('div', 'arasuji-next');
      const b = button('arasuji-button arasuji-next-button', label, () => {
        api.markRead(order);
        // 読了後の resume() は最後の節の見出しへ戻ってしまうので、最後の節ではフォーカスを動かさない
        if (isLast) api.announce('このページを読み終えました。');
        else api.resume();
      });
      b.addEventListener('focus', () => api.markRead(order));
      wrap.append(b);

      // 見出しの親が <section> で、次の見出しがその外にあれば、その <section> の末尾が節の終わり（ドキュメント風）。
      // 次の見出しが同じ <section> の中にあれば、次の見出しの直前（教材風。1つの <section> に見出しが並ぶページもこちら）
      const parent = h.parentElement;
      const section = parent && parent.tagName === 'SECTION' && parent !== container ? parent : null;
      const next = isLast ? null : headings[i + 1];
      if (next && (!section || section.contains(next))) {
        next.before(wrap);
      } else if (section && !(endMarker && section.contains(endMarker))) {
        section.append(wrap);
      } else if (endMarker) {
        endMarker.before(wrap);
      } else {
        container.append(wrap);
      }
    });

    // --- 状態の反映・字幕・光らせる演出
    document.addEventListener('arasuji:change', () => {
      text.textContent = api.getRecapText();
    });
    document.addEventListener('arasuji:announce', e => {
      caption.textContent = `読み上げ：${e.detail.text}`;
      panel.classList.remove('arasuji-flash');
      void panel.offsetWidth; // アニメーションをやり直す
      panel.classList.add('arasuji-flash');
    });
  }

  function injectStyle(cfg) {
    if (document.getElementById('arasuji-style')) return;
    const style = document.createElement('style');
    style.id = 'arasuji-style';
    // ページ側が --arasuji-accent を指定すればそれを使う
    style.textContent = `
.arasuji-recap, .arasuji-next { --arasuji-c: var(--arasuji-accent, ${cfg.accent}); }
.arasuji-recap {
  box-sizing: border-box; max-width: 100%; margin: 1.5em 0; padding: 1em 1.25em;
  border: 2px solid var(--arasuji-c); border-radius: 10px; background: #fff; color: #222;
  font-size: 1rem; line-height: 1.7; overflow-wrap: anywhere;
}
.arasuji-recap * { box-sizing: border-box; }
.arasuji-recap .arasuji-recap-heading {
  margin: 0 0 .5em; padding: 0; border: 0; font-size: 1.15em; line-height: 1.4; color: var(--arasuji-c);
}
.arasuji-recap .arasuji-recap-text { margin: 0 0 .75em; }
.arasuji-actions { display: flex; flex-wrap: wrap; gap: .5em; margin: 0 0 .75em; }
.arasuji-button {
  appearance: none; margin: 0; padding: .55em 1em; min-height: 44px;
  border: 2px solid var(--arasuji-c); border-radius: 6px; background: #fff; color: var(--arasuji-c);
  font: inherit; font-weight: bold; line-height: 1.3; cursor: pointer;
}
.arasuji-button:hover { background: color-mix(in srgb, var(--arasuji-c) 10%, #fff); }
.arasuji-button-primary, .arasuji-button-primary:hover { background: var(--arasuji-c); color: #fff; }
.arasuji-button:focus-visible, .arasuji-reset:focus-visible, .arasuji-autoplay-input:focus-visible {
  outline: 3px solid var(--arasuji-c); outline-offset: 2px;
}
.arasuji-recap .arasuji-caption {
  margin: 0 0 .75em; padding: .5em .75em; border-radius: 6px; background: #f4f6f8; color: #333; font-size: .9em;
}
.arasuji-recap .arasuji-caption:empty { display: none; }
.arasuji-options {
  display: flex; flex-wrap: wrap; align-items: center; gap: .5em 1.5em;
  padding-top: .75em; border-top: 1px solid #ddd; font-size: .9em; color: #555;
}
.arasuji-autoplay { display: inline-flex; align-items: center; gap: .4em; cursor: pointer; }
.arasuji-autoplay-input { width: 1.2em; height: 1.2em; margin: 0; accent-color: var(--arasuji-c); }
.arasuji-recap .arasuji-shortcuts { margin: 0; flex-basis: 100%; }
.arasuji-reset {
  appearance: none; margin: 0 0 0 auto; padding: .3em .5em; border: 0; background: none;
  color: #666; font: inherit; text-decoration: underline; cursor: pointer;
}
.arasuji-next { margin: 2em 0 2.5em; text-align: right; }
@keyframes arasuji-flash {
  0% { box-shadow: 0 0 0 0 var(--arasuji-c); }
  30% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--arasuji-c) 45%, transparent); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.arasuji-recap.arasuji-flash { animation: arasuji-flash .9s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .arasuji-recap.arasuji-flash { animation: none; }
}
@media (max-width: 480px) {
  .arasuji-recap { padding: .85em; }
  .arasuji-actions .arasuji-button { flex: 1 1 100%; }
  .arasuji-next { text-align: left; }
  .arasuji-next .arasuji-button { width: 100%; }
}
`;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // 初期化

  const cfg = resolveConfig(source);
  const store = createStore();

  function init() {
    // ブックマークレットを2回押した、ページと拡張の両方が入れた、などで二重に動かないようにする。
    // 拡張は別の JS 環境で動き window.Arasuji が見えないので、DOM に置いたライブ通知領域で確かめる
    if (document.getElementById('arasuji-live')) {
      console.info('[arasuji] このページではすでに動いています');
      return;
    }
    const core = createCore(cfg, store);
    if (!core) return; // コンテナや見出しがなければ何もしない
    const voice = createVoice(core, cfg, store);

    let resolveReady;
    const ready = new Promise(r => { resolveReady = r; });
    window.Arasuji = Object.assign({}, core.api, voice.api, { ready });

    if (cfg.ui !== 'off') createDefaultUI(window.Arasuji, cfg);

    const state = core.api.getState();
    resolveReady(state);
    emit('arasuji:ready', state);
  }

  // defer なしで <head> に置かれた場合にも動くようにする
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
