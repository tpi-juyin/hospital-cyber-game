/** Keep fullscreen on the document root, including scene changes and dialogs. */
type SafariDocument = Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void | Promise<void> };
type SafariRoot = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
let pending = false;
const doc = () => document as SafariDocument;
const root = () => document.documentElement as SafariRoot;
const standalone = () => typeof window !== 'undefined' && (!!(navigator as Navigator & { standalone?: boolean }).standalone || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches);
const active = () => typeof document !== 'undefined' && !!(document.fullscreenElement || doc().webkitFullscreenElement);
const standard = () => !!root().requestFullscreen && document.fullscreenEnabled !== false;
const prefixed = () => !!root().webkitRequestFullscreen && doc().webkitFullscreenEnabled !== false;
const supported = () => typeof document !== 'undefined' && (standard() || prefixed());
export function fullscreenButton() {
  if (standalone()) return '';
  return `<button type="button" class="icon-button fullscreen-button ${active() ? 'audio-on' : ''}" data-fullscreen aria-label="${active() ? '離開全螢幕' : '全螢幕遊玩'}" aria-pressed="${active()}" title="${supported() ? active() ? '離開全螢幕' : '全螢幕遊玩' : '查看全螢幕遊玩說明'}"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>`;
}
function sync() {
  document.querySelectorAll<HTMLButtonElement>('[data-fullscreen]').forEach(b => {
    b.hidden = standalone();
    b.setAttribute('aria-pressed', String(active())); b.classList.toggle('audio-on', active());
    b.setAttribute('aria-label', active() ? '離開全螢幕' : '全螢幕遊玩');
    b.title = supported() ? active() ? '離開全螢幕' : '全螢幕遊玩' : '查看全螢幕遊玩說明';
    b.disabled = pending;
  });
}
function notice(message: string) {
  document.querySelector('#fullscreen-notice')?.remove();
  const el = document.createElement('div');el.id='fullscreen-notice';el.setAttribute('role','status');el.textContent=message;
  document.body.append(el);setTimeout(()=>el.remove(),4500);
}
function showHelp() {
  if (document.querySelector('#fullscreen-help')) return;
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.id = 'fullscreen-help'; dialog.setAttribute('aria-labelledby', 'fullscreen-help-title');
  const ua = navigator.userAgent;
  // iPadOS desktop browsing identifies as Macintosh, but still has touch input.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const mac = /Macintosh|Mac OS X/.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS|FxiOS/.test(ua);
  let instructions: string;
  if (ios) {
    instructions = '<ol><li>在 Safari 點「分享」。</li><li>選擇「加入主畫面」；若有「作為網頁 App 開啟」，請保持開啟。</li><li>回到裝置主畫面，點遊戲圖示進入。</li></ol>';
  } else if (/Android/.test(ua)) {
    instructions = '<p>開啟瀏覽器選單，選擇「加入主畫面」或「安裝應用程式」，再從主畫面的遊戲圖示開啟。</p>';
  } else if (mac && safari) {
    instructions = '<p>在 Safari 上方選單選擇「顯示方式 → 進入全螢幕」。</p>';
  } else {
    instructions = '<p>開啟瀏覽器選單，尋找「全螢幕」選項。</p>';
  }
  dialog.innerHTML = `<h2 id="fullscreen-help-title">更大的遊戲畫面</h2><p>此瀏覽器目前無法直接開啟全螢幕，仍可照常遊玩。</p>${instructions}<button type="button" autofocus>知道了，返回遊戲</button>`;
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus(); });
  document.body.append(dialog); dialog.showModal();
}
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  for (const mode of ['standalone', 'fullscreen']) window.matchMedia(`(display-mode: ${mode})`).addEventListener('change', sync);
  window.addEventListener('pageshow', sync);
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-fullscreen]') || pending || standalone()) return;
    if (!supported()) { showHelp(); return; }
    pending = true;sync();
    // Call directly within the user gesture, including the Safari-prefixed API.
    void (async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (doc().webkitFullscreenElement) await doc().webkitExitFullscreen?.();
        else if (standard()) await root().requestFullscreen();
        else await root().webkitRequestFullscreen!();
      } catch { notice('無法開啟或切換全螢幕，請稍後再試；遊戲可繼續進行。'); }
      finally { pending = false;sync(); }
    })();
  });
}
