// ブックマークレットから読み込まれ、sites.js でこのページの設定を決めてから arasuji.js を読み込む。
// 本文が iframe の中にあるサイトでは、同じオリジンの iframe を何段でもたどって、その中に入れる
(() => {
  const base = document.currentScript ? document.currentScript.src : location.href;

  // 外側のページと、同じオリジンの iframe を外側から順に集める。別オリジンの iframe の中には触れない
  function collect(win, out) {
    let doc;
    try {
      doc = win.document;
      if (!doc || !doc.body) return out;
    } catch (_) {
      return out; // 別オリジン
    }
    out.push({ win, doc });
    for (let i = 0; i < win.frames.length; i++) collect(win.frames[i], out);
    return out;
  }

  const docs = collect(window, []);

  // すでに動いていれば、もう一度押したときはあらすじを読む。
  // 拡張機能が入れたものは別の JS 環境にあって Arasuji が見えないので、そう知らせる
  const running = docs.filter(d => d.doc.getElementById('arasuji-live'));
  if (running.length) {
    const withApi = running.find(d => d.win.Arasuji);
    if (withApi) withApi.win.Arasuji.recap();
    else alert('arasuji：このページではすでに arasuji が動いています（拡張機能などが入れたもの）。');
    return;
  }

  // script はその文書の中に作る。そうするとその文書（iframe）の中で動く
  function load(doc, file, dataset) {
    return new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = new URL(file, base).href;
      if (dataset) Object.assign(s.dataset, dataset);
      s.onload = resolve;
      s.onerror = () => reject(new Error(`${file} を読み込めませんでした`));
      doc.body.appendChild(s);
    });
  }

  load(document, 'sites.js')
    .then(() => {
      const sites = window.ARASUJI_SITES;
      const candidates = docs.map(d => Object.assign({}, d, sites.probe(d.win.location.href, d.doc)));
      const target = sites.pick(candidates);
      if (!target) {
        alert('arasuji：このページでは節の見出しが見つかりませんでした。');
        return null;
      }
      return load(target.doc, 'arasuji.js', target.cfg).then(() => {
        if (!target.doc.getElementById('arasuji-live')) {
          alert('arasuji：このページでは節の見出しが見つかりませんでした。');
        }
      });
    })
    .catch(e => {
      // CSP で外部の script が止められたサイトなど
      alert(`arasuji：${e.message}。このサイトではブックマークレットが使えない可能性があります。`);
    });
})();
