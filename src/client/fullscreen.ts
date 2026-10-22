/** Fullscreen the stable document root so scene changes and body dialogs stay visible. */
let pending = false;
const supported = () => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
export function fullscreenButton() {
  const active = typeof document !== 'undefined' && !!document.fullscreenElement;
  return `<button type="button" class="icon-button fullscreen-button ${active ? 'audio-on' : ''}" data-fullscreen aria-label="${active ? '離開全螢幕' : '全螢幕遊玩'}" aria-pressed="${active}" title="${supported() ? active ? '離開全螢幕' : '全螢幕遊玩' : '此瀏覽器不支援全螢幕'}"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>`;
}
function sync() {
  document.querySelectorAll<HTMLButtonElement>('[data-fullscreen]').forEach(b => {
    const active = typeof document !== 'undefined' && !!document.fullscreenElement;
    b.setAttribute('aria-pressed', String(active)); b.classList.toggle('audio-on', active);
    b.setAttribute('aria-label', active ? '離開全螢幕' : '全螢幕遊玩');
    b.title = supported() ? active ? '離開全螢幕' : '全螢幕遊玩' : '此瀏覽器不支援全螢幕';
    b.disabled = pending;
  });
}
function notice(message: string) {
  document.querySelector('#fullscreen-notice')?.remove();
  const el = document.createElement('div');el.id='fullscreen-notice';el.setAttribute('role','status');el.textContent=message;
  document.body.append(el);setTimeout(()=>el.remove(),4500);
}
if (typeof document !== 'undefined') {
document.addEventListener('fullscreenchange', sync);
document.addEventListener('click', event => {
  if (!(event.target instanceof Element) || !event.target.closest('[data-fullscreen]') || pending) return;
  if (!supported()) { notice('此瀏覽器不支援全螢幕，仍可直接遊玩或旋轉手機。'); return; }
  pending = true;sync();
  // Invoke directly in the click handler, before any await loses user activation.
  void (async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notice('無法開啟或切換全螢幕，請稍後再試；遊戲可繼續進行。'); }
    finally { pending = false;sync(); }
  })();
});

}
