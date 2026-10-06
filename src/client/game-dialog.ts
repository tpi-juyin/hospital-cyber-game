import { escape as esc, icon } from './art';

/** A non-blocking game prompt. The authoritative match clock keeps running. */
export class GameDialog {
  private dismiss?: (confirmed: boolean) => void;
  get isOpen() { return !!this.dismiss; }
  close() { this.dismiss?.(false); }
  open(options: { title: string; message: string; confirm: string; cancel?: string; tone?: string }): Promise<boolean> {
    if (this.isOpen) return Promise.resolve(false);
    const previous = document.activeElement as HTMLElement | null, app = document.querySelector<HTMLElement>('#app');
    const wasInert = app?.inert || false;
    const root = document.createElement('div'); root.className = 'game-dialog-backdrop';
    root.innerHTML = `<section class="game-dialog ${options.tone || ''}" role="dialog" aria-modal="true" aria-labelledby="game-dialog-title" aria-describedby="game-dialog-description"><span class="dialog-emblem">${icon('shield', 36)}</span><span class="dialog-kicker">MISSION CONTROL</span><h2 id="game-dialog-title">${esc(options.title)}</h2><p id="game-dialog-description">${esc(options.message)}</p><div class="dialog-actions"><button class="primary-button" data-cancel>${esc(options.cancel || '取消')}</button><button class="danger-button" data-confirm>${esc(options.confirm)}</button></div></section>`;
    document.body.append(root); if (app) app.inert = true;
    document.body.classList.add('dialog-open');
    const cancel = root.querySelector<HTMLButtonElement>('[data-cancel]')!, confirm = root.querySelector<HTMLButtonElement>('[data-confirm]')!;
    return new Promise(resolve => {
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(false); }
        else if (event.key === 'Tab') {
          event.preventDefault(); event.stopImmediatePropagation();
          (document.activeElement === cancel ? confirm : cancel).focus();
        }
      };
      const finish = (confirmed: boolean) => {
        if (!this.dismiss) return;
        this.dismiss = undefined; document.removeEventListener('keydown', keydown, true);
        root.remove(); document.body.classList.remove('dialog-open'); if (app) app.inert = wasInert;
        if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
        resolve(confirmed);
      };
      this.dismiss = finish;
      cancel.addEventListener('click', () => finish(false)); confirm.addEventListener('click', () => finish(true));
      root.addEventListener('click', event => { if (event.target === root) finish(false); });
      document.addEventListener('keydown', keydown, true); cancel.focus();
    });
  }
}
