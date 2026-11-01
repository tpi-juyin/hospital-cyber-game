import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLElement } from 'happy-dom';
import { HostRooms } from '../src/client/host-rooms';
import { Engine } from '../src/server/engine';

test('host buttons survive repeated live updates, preserve focus and still activate', t => {
 const w=new Window();t.after(()=>w.happyDOM.close());const root=w.document.body;
 const view=new HostRooms(root as unknown as globalThis.HTMLElement),e=new Engine(),p=e.connect();
 e.action(p.id,{kind:'create',mode:'solo',role:'defense',duration:60});const r=e.playerView(p.id)!;r.phase='playing';
 view.render([r]);const button=root.querySelector<HTMLElement>('[data-project]')!,card=button.closest('.room-card');button.focus();
 let clicks=0;button.addEventListener('click',()=>clicks++);
 for(let i=0;i<20;i++){r.hp-=1;r.remainingMs-=500;view.render([r]);}
 assert.ok(root.querySelector('[data-project]')===button, 'live refresh must preserve the original button');assert.equal(button.closest('.room-card'),card);assert.equal(w.document.activeElement,button);
 button.click();assert.equal(clicks,1);assert.match(root.textContent,/血量 80%/);
 const other={...r,id:'another-room',code:'9999'};view.render([r,other]);assert.ok(root.querySelector('[data-project]')===button, 'live refresh must preserve the original button');
 view.render([r]);assert.equal(root.querySelectorAll('.room-card').length,1);assert.ok(root.querySelector('[data-project]')===button, 'live refresh must preserve the original button');
 view.render([]);assert.equal(root.querySelectorAll('[data-project]').length,0);assert.ok(root.querySelector('.empty-board'));
});

test('host card results use defense perspective and rematch clears result styling',t=>{
 const w=new Window();t.after(()=>w.happyDOM.close());const root=w.document.body,view=new HostRooms(root as unknown as globalThis.HTMLElement),e=new Engine(),p=e.connect();
 e.action(p.id,{kind:'create',mode:'solo',role:'defense',duration:60});const r=e.playerView(p.id)!;
 r.members[0].name='<img src=x onerror=alert(1)>';r.phase='ended';r.winner='defense';view.render([r]);
 assert.match(root.querySelector('.defense-win')!.textContent,/成功抵禦攻擊/);assert.equal(root.querySelectorAll('img').length,0);
 r.winner='attack';view.render([r]);assert.match(root.querySelector('.defense-loss')!.textContent,/醫院防線失守/);
 r.winner=null;view.render([r]);assert.match(root.querySelector('.no-contest')!.textContent,/不計勝負/);
 r.phase='waiting';view.render([r]);assert.equal(root.querySelectorAll('.defense-win,.defense-loss,.no-contest').length,0);assert.match(root.querySelector('.phase-pill')!.textContent,/等待準備/);
});
