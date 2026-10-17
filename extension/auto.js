// 「自動で使う」にしたサイトで、すべての frame の読み込みが終わったときに動く（sites.js のあと）。
// その frame の中で節を数え、節があれば background に arasuji.js の差し込みを頼む。
// 本文を JavaScript で後から入れるページもあるので、節がなければしばらく DOM の変化を待って数え直す
(() => {
  const WAIT_MS = 30 * 1000; // 節が現れるのを待つ長さ
  const SETTLE_MS = 500; // DOM の変化が落ち着いてから数える

  const sites = globalThis.ARASUJI_SITES;
  const site = sites.findSite(location.href);
  if (site && site.skip) return;
  // 設定済みでないサイトでは、外側のページだけで使う（広告などの iframe に入れない）
  if (!site && window !== window.top) return;

  chrome.runtime.sendMessage({ type: 'auto-settings' }).then(settings => {
    if (!settings) return;
    const tryRun = () => {
      const found = sites.probe(location.href, document, settings.override);
      if (found.running) return true; // ページやほかの経路で動いている
      if (found.skip || found.headings === 0) return false;
      // 拡張の content script は同じ JS 環境を共有するので、ここで置いた設定を arasuji.js が読む
      window.ARASUJI_CONFIG = Object.assign({}, found.cfg, settings.shortcuts ? { shortcuts: 'on' } : {});
      chrome.runtime.sendMessage({ type: 'auto-run' }).catch(() => {});
      return true;
    };
    if (tryRun()) return;

    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (tryRun()) stop(); }, SETTLE_MS);
    });
    const giveUp = setTimeout(() => stop(), WAIT_MS);
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(giveUp);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }).catch(() => {});
})();
