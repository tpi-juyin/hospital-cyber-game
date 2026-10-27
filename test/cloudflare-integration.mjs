import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=process.env.GAME_URL||'http://127.0.0.1:8790',password=process.env.HOST_PASSWORD;
let cookie='';const clients=[];
async function api(path,body,auth=true){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,...(auth?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});}
async function host(a){const r=await api('/api/host/action',a);assert.equal(r.status,200,await r.clone().text());}
function connect(kind='player',token){
 const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws/'+kind,{headers:{Origin:base,...(kind==='host'?{Cookie:cookie}:{})}});clients.push(ws);
 const c={ws,session:null,room:null,lobby:null,view:null,seq:0,acks:new Map(),history:[]};
 c.wait=async predicate=>{const end=Date.now()+8000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out waiting for '+predicate);};
 c.action=a=>new Promise(resolve=>{const id=++c.seq;c.acks.set(id,resolve);ws.send(JSON.stringify({event:'action',data:a,id}));});
 c.subscribe=path=>ws.send(JSON.stringify({event:'subscribe',data:{path}}));
 c.ready=new Promise((resolve,reject)=>{
 ws.on('open',()=>ws.send(JSON.stringify({event:'hello',data:{token}})));ws.on('error',reject);
 ws.on('message',raw=>{if(String(raw)==='pong')return;const m=JSON.parse(raw);c.history.push(m.event);if(m.event==='session')c.session=m.data;if(m.event==='room')c.room=m.data;if(m.event==='lobby')c.lobby=m.data;if(m.event==='view')c.view=m.data;if(m.event==='ack'){c.acks.get(m.id)?.(m.data);c.acks.delete(m.id);}if(m.event==='connect')resolve(c);if(m.event==='connect_error')reject(Error(m.data.code));});
 });const heartbeat=setInterval(()=>{if(ws.readyState===1)ws.send('ping');},5000);ws.on('close',()=>clearInterval(heartbeat));return c;
}
try{
 assert.equal((await api('/api/host/state',undefined,false)).status,401);
 const login=await fetch(base+'/host/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}),redirect:'manual'});
 assert.equal(login.status,303);cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(base+'/host',{headers:{Cookie:cookie},redirect:'manual'})).status,200);
 assert.equal((await fetch(base+'/api/host/action',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example'},body:'{}'})).status,403);
 await host({kind:'stop'});await host({kind:'accepting',value:true});await host({kind:'duration',value:30});await host({kind:'allow-surrender',value:true});
 const observer=await connect('spectator').ready;observer.subscribe('/api/spectate/rooms');await observer.wait(()=>observer.view?.data.rooms);
 assert.equal((await observer.action({kind:'stop'})).code,'FORBIDDEN');
 const h=await connect('host').ready;h.subscribe('/api/host/state');await h.wait(()=>h.view?.data.lobby);
 const a=await connect().ready,b=await connect().ready;
 assert.equal((await a.action({kind:'create',mode:'duo',role:'attack'})).ok,true);await a.wait(()=>a.room);
 assert.equal((await b.action({kind:'join',code:a.room.code})).ok,true);
 await observer.wait(()=>observer.view?.data.rooms.length===1);
 observer.subscribe('/api/spectate/rooms/'+a.room.id);await observer.wait(()=>observer.view?.data.room);
 assert.equal('ownerId' in observer.view.data.room,false);assert.equal(JSON.stringify(observer.view).includes(a.session.token),false);
 await a.action({kind:'ready',ready:true});await b.action({kind:'ready',ready:true});await a.wait(()=>a.room.phase==='playing');
 const round=a.room.roundId;assert.equal((await a.action({kind:'tap',roundId:round,seq:1})).ok,true);assert.equal((await a.action({kind:'tap',roundId:round,seq:1})).ok,false);
 await a.action({kind:'away',roundId:round,seq:2});await b.wait(()=>b.room.phase==='paused');await a.action({kind:'resume',roundId:round,seq:3});await b.wait(()=>b.room.phase==='playing');
 a.ws.close();await b.wait(()=>b.room.phase==='paused');const a2=await connect('player',a.session.token).ready;assert.equal(a2.session.id,a.session.id);await a2.action({kind:'resume',roundId:round,seq:4});await b.wait(()=>b.room.phase==='playing');
 await a2.action({kind:'surrender',roundId:round,seq:5});await b.wait(()=>b.room.phase==='ended');assert.equal(b.room.winner,'defense');assert.equal(b.room.lessons.length,2);
 await a2.action({kind:'leave'});await b.action({kind:'leave'});
 await a2.action({kind:'create',mode:'solo',role:'defense',startImmediately:true});await a2.wait(()=>a2.room.phase==='playing');assert.equal(a2.room.duration,30);assert.equal(a2.room.members.some(m=>m.bot),true);
 await a2.action({kind:'away',roundId:a2.room.roundId,seq:6});await a2.wait(()=>a2.room.phase==='paused');assert.ok(a2.room.reconnectMs>58000);
 await host({kind:'stop'});await h.wait(()=>h.view?.data.rooms.length===0);assert.ok(a2.history.includes('hosting-reset'));
 console.log('PASS: cloud auth/CSRF, host feed, read-only spectators, duo countdown/tap/replay/pause/reconnect/surrender, solo bot/pause, activity stop');
}finally{for(const c of clients)c.close();if(cookie){await host({kind:'stop'});await host({kind:'duration',value:60});await host({kind:'allow-surrender',value:false});await host({kind:'accepting',value:true});}}
