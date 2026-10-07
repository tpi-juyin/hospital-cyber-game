import QRCode from 'qrcode';

/** Enlarged public QR; callers close it whenever the advertised URL becomes stale. */
export class QrDialog {
  private dismiss?: () => void;
  get isOpen() { return !!this.dismiss; }
  close() { this.dismiss?.(); }
  open(url: string, onError: () => void) {
    if (!url || this.isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const app = document.querySelector<HTMLElement>('#app'), wasInert = app?.inert || false;
    const root = document.createElement('div'); root.className = 'game-dialog-backdrop qr-dialog-backdrop';
    root.innerHTML = `<section class="game-dialog qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-dialog-title"><span class="dialog-kicker">JOIN THE BATTLE</span><h2 id="qr-dialog-title">掃描，加入活動</h2><div class="qr-large-frame"><canvas aria-label="加入遊戲的放大 QR Code"></canvas></div><p>使用手機相機掃描 QR Code</p><button class="primary-button" type="button" data-close-qr>關閉放大畫面</button></section>`;
    document.body.append(root); if (app) app.inert = true;
    document.body.classList.add('dialog-open');
    const close = root.querySelector<HTMLButtonElement>('[data-close-qr]')!;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
      else if (event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); close.focus(); }
    };
    this.dismiss = () => {
      this.dismiss = undefined; document.removeEventListener('keydown', keydown, true);
      root.remove(); document.body.classList.remove('dialog-open'); if (app) app.inert = wasInert;
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
    };
    close.addEventListener('click', () => this.close());
    root.addEventListener('click', event => { if (event.target === root) this.close(); });
    document.addEventListener('keydown', keydown, true); close.focus();
    void QRCode.toCanvas(root.querySelector('canvas')!, url, { width: 800, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#193246', light: '#fffdf5' } }).catch(() => {
      if (root.isConnected) { this.close(); onError(); }
    });
  }
}
