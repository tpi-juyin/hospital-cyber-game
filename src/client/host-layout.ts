/** Move the existing settings controls without replacing their nodes or event handlers. */
export function setupHostLayout(app: HTMLElement) {
  const doc=app.ownerDocument,shell=app.querySelector<HTMLElement>('.host-shell')!;
  shell.classList.add('host-dashboard');
  const counts=shell.querySelector('.host-counts')!,heading=shell.querySelector('.board-heading')!;
  heading.append(counts);shell.querySelector('.host-intro')!.remove();
  shell.querySelector('#rooms')!.parentElement!.classList.add('host-battle-board');
  const controls=shell.querySelector<HTMLElement>('.host-controls')!;
  const dialog=doc.createElement('dialog');dialog.className='host-settings-dialog';dialog.setAttribute('aria-labelledby','host-settings-title');
  dialog.innerHTML='<header><h2 id="host-settings-title">活動設定</h2><button type="button" class="secondary-button" data-settings-close>完成</button></header>';
  controls.querySelector('h2')!.remove();dialog.append(controls);app.append(dialog);
  const open=doc.createElement('button');open.type='button';open.className='secondary-button';open.id='open-settings';open.textContent='活動設定';open.setAttribute('aria-haspopup','dialog');
  shell.querySelector('.host-header-actions')!.append(open);
  open.addEventListener('click',()=>dialog.showModal());
  dialog.querySelector('[data-settings-close]')!.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  return dialog;
}
