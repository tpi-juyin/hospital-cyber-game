import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServers } from '../src/server/index';
import { build } from 'esbuild';
import { Window, type HTMLButtonElement, type HTMLElement } from 'happy-dom';
import { Engine } from '../src/server/engine';
import { GAME_VERSION } from '../src/shared/version';

test('spectator endpoints are read-only, work at capacity and expose no session or host credentials', async t => {
  const s=await startServers();t.after(()=>s.stop());
  const p=s.engine.connect();s.engine.action(p.id,{kind:'create',mode:'solo',role:'attack',duration:60});
  const room=s.engine.playerView(p.id)!;
  for(let i=1;i<30;i++)s.engine.connect();
  const before=s.engine.players.size;
  const list=await (await fetch(s.playerUrl+'/api/spectate/rooms')).json();
  assert.equal(list.rooms.length,1);assert.equal(list.rooms[0].code,room.code);
  assert.deepEqual(Object.keys(list.rooms[0].members[0]).sort(),['name','role']);
  const detail=await (await fetch(s.playerUrl+'/api/spectate/rooms/'+room.id)).json();
  assert.equal(detail.room.hp,100);assert.equal(detail.room.ownerId,undefined);
  assert.equal(JSON.stringify(detail).includes(p.token),false);
  assert.equal(detail.room.members[0].token,undefined);assert.equal(s.engine.players.size,before);
  for(const method of ['POST','PUT','DELETE']) {
    assert.equal((await fetch(s.playerUrl+'/api/spectate/rooms/'+room.id,{method,body:JSON.stringify({kind:'close',roomId:room.id})})).status,405);
  }
  assert.equal((await fetch(s.playerUrl+'/api/host/state')).status,403);
  assert.equal((await fetch(s.playerUrl+'/api/host/action',{method:'POST',body:'{"kind":"stop"}'})).status,405);
  assert.ok(s.engine.rooms.has(room.id));
  for(const path of ['/watch','/watch/','/watch.html'])assert.match(await (await fetch(s.playerUrl+path)).text(),/觀戰大廳/);
  s.engine.closeRoom(room.id);
  assert.equal((await fetch(s.playerUrl+'/api/spectate/rooms/'+room.id)).status,404);
  assert.deepEqual((await (await fetch(s.playerUrl+'/api/spectate/rooms')).json()).rooms,[]);
});

test('cloud spectator routes do not authorize host mutations', async t=>{
  const s=await startServers({cloud:{origin:'https://game.example',password:'spectator-test-password-only',port:0}});t.after(()=>s.stop());
  assert.equal((await fetch(s.playerUrl+'/api/spectate/rooms')).status,200);
  assert.equal((await fetch(s.playerUrl+'/api/host/action',{method:'POST',headers:{Origin:'https://game.example'},body:'{"kind":"stop"}'})).status,401);
  assert.equal(s.engine.accepting,true);
});

test('spectator UI lists safe names, keeps watch buttons stable, returns to lobby and handles room closure', async t=>{
  const compiled=await build({entryPoints:['src/client/spectator.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'}});
  const w=new Window({url:'https://game.example/watch',settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
  const e=new Engine(),p=e.connect();e.action(p.id,{kind:'name',name:'<b>玩家</b>'});e.action(p.id,{kind:'create',mode:'solo',role:'defense',duration:60});
  const room=e.playerView(p.id)!;let closed=false,failed=false;const requests:string[]=[];
  w.fetch=(async(url:unknown,options?:{method?:string})=>{requests.push(String(url));assert.equal(options?.method,undefined);
    if(failed)throw new Error('offline');
    const detail=String(url).endsWith('/'+room.id);
    return {ok:!(detail&&closed),status:detail&&closed?404:200,json:async()=>({version:GAME_VERSION,...(detail?{room}:{rooms:closed?[]:[room]})})};
  }) as unknown as typeof w.fetch;
  w.document.body.innerHTML='<div id="app"></div>';w.eval(compiled.outputFiles[0].text);
  const wait=()=>new Promise(r=>setTimeout(r,600));await wait();
  assert.equal(w.document.querySelector('.watch-card-content b b'),null);
  const button=w.document.querySelector<HTMLButtonElement>('[data-watch]')!;assert.ok(button);
  button.click();await wait();assert.equal(w.document.title,'醫院資安攻防戰 · 戰況儀表板');
  assert.equal(w.document.querySelector('[data-exit]')!.textContent!.trim(),'返回觀戰大廳');
  assert.equal(w.document.querySelector('[data-close],#stop,#tap,#ultimate'),null);
  failed=true;await wait();assert.equal(w.document.querySelector<HTMLElement>('#monitor-stale')!.hidden,false);
  failed=false;await wait();assert.equal(w.document.querySelector<HTMLElement>('#monitor-stale')!.hidden,true);
  w.document.querySelector<HTMLButtonElement>('[data-exit]')!.click();await wait();
  assert.equal(w.document.title,'醫院資安攻防戰 · 觀戰大廳');assert.equal(w.document.querySelector('[data-watch]'),button);
  button.click();await wait();closed=true;await wait();await wait();
  assert.equal(w.document.title,'醫院資安攻防戰 · 觀戰大廳');assert.ok(w.document.querySelector('.watch-empty'));
  assert.ok(requests.every(r=>r.startsWith('/api/spectate/rooms')));
});
