import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Engine, GameError } from './engine';
import { GAME_VERSION } from '../shared/version';
import { loginPage } from './login-page';

interface Env { GAME:DurableObjectNamespace<GameEvent>; ASSETS:Fetcher; HOST_PASSWORD:string }
type Peer={kind:'player'|'host'|'spectator';id?:string;path?:string;hostToken?:string;last:number;window:number;count:number};
type Saved={engine:ReturnType<Engine['snapshot']>;auth:{sessions:[string,number][];attempts:number[];fingerprint:string};created:number};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const hash=(s:string)=>createHash('sha256').update(s).digest();
const cookie=(r:Request)=>(r.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-hospital='))?.slice(16)||'';
function secured(r:Response) {
  if(r.status===101)return r;
  const out=new Response(r.body,r);out.headers.set('X-Content-Type-Options','nosniff');out.headers.set('Referrer-Policy','same-origin');
  out.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");return out;
}
export default {async fetch(req:Request,env:Env):Promise<Response>{
  const url=new URL(req.url),p=url.pathname;
  if(p==='/api/health')return secured(json({ok:true,entry:'participant',version:GAME_VERSION,platform:'cloudflare'}));
  if(p.startsWith('/api/')||p.startsWith('/ws/')||p==='/host'||p.startsWith('/host/')||p==='/host.html') {
    if(!env.HOST_PASSWORD||env.HOST_PASSWORD.length<16||env.HOST_PASSWORD.length>256)return secured(json({error:'主持密碼尚未設定。'},503));
    if((req.method!=='GET'&&req.method!=='HEAD'||p.startsWith('/ws/'))&&req.headers.get('Origin')!==url.origin)return secured(json({error:'無效操作來源。'},403));
    return secured(await env.GAME.get(env.GAME.idFromName('activity-v1')).fetch(req));
  }
  return secured(await env.ASSETS.fetch(req));
}} satisfies ExportedHandler<Env>;

export class GameEvent extends DurableObject<Env> {
  private engine=new Engine(()=>Date.now());
  private peers=new Map<WebSocket,Peer>();
  private auth:Saved['auth']={sessions:[],attempts:[],fingerprint:''};
  private created=Date.now();private timer?:ReturnType<typeof setInterval>;private ticks=0;private savedAt=0;
  private limits=new Map<string,number[]>();
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
    ctx.blockConcurrencyWhile(async()=>{
      const saved=await ctx.storage.get<Saved>('activity');
      if(saved){this.engine.restore(saved.engine);this.auth=saved.auth;this.created=saved.created;
        // Active rounds cannot safely resume from a periodic checkpoint after a crash.
        for(const r of this.engine.rooms.values())if(['playing','countdown','paused'].includes(r.phase)){r.phase='ended';r.winner=null;r.reason='雲端服務重新啟動，本局不計勝負。';r.lessons=[];r.touchedAt=Date.now();}
      }
      const fingerprint=hash(env.HOST_PASSWORD||'').toString('hex');
      if(this.auth.fingerprint!==fingerprint)this.auth={sessions:[],attempts:[],fingerprint};
      for(const p of this.engine.players.values())if(!p.bot){if(p.connected)p.disconnectedAt=Date.now();p.connected=false;}
      for(const ws of ctx.getWebSockets()){
        const p=ws.deserializeAttachment() as Peer;this.peers.set(ws,p);
        if(p.kind==='player'&&p.id){const player=this.engine.players.get(p.id);if(player)player.connected=true;else ws.close(1012,'session expired');}
      }
      this.engine.advance();await this.save();
    });
  }
  private async save(){this.savedAt=Date.now();await this.ctx.storage.put('activity',{engine:this.engine.snapshot(),auth:this.auth,created:this.created} satisfies Saved);}
  private authorized(token:string){this.auth.sessions=this.auth.sessions.filter(([,until])=>until>Date.now());return this.auth.sessions.some(([t])=>t===token);}
  private limited(key:string,max:number,period=60000){const list=(this.limits.get(key)||[]).filter(t=>Date.now()-t<period);if(list.length>=max)return true;list.push(Date.now());this.limits.set(key,list);return false;}
  private send(ws:WebSocket,event:string,data?:unknown,id?:number){try{ws.send(JSON.stringify({event,data,id}));}catch{}}
  private view(path:string){
    this.engine.advance();
    if(path==='/api/host/state')return {lobby:this.engine.lobby(),rooms:[...this.engine.rooms.keys()].map(id=>this.engine.view(id)),hostingMode:'cloud',uptimeSeconds:Math.floor((Date.now()-this.created)/1000),tunnelStatus:'Cloudflare 測試入口已就緒。',tunnelControl:{available:false,busy:false,failed:false}};
    if(path==='/api/spectate/rooms')return {version:GAME_VERSION,rooms:[...this.engine.rooms.keys()].map(id=>{const r=this.engine.view(id)!;return {id:r.id,code:r.code,mode:r.mode,phase:r.phase,hp:r.hp,shield:r.shield,remainingMs:r.remainingMs,duration:r.duration,members:r.members.map(({name,role})=>({name,role}))};})};
    if(path.startsWith('/api/spectate/rooms/')){const r=this.engine.view(path.slice('/api/spectate/rooms/'.length));if(!r)return null;const {ownerId,...room}=r;return {version:GAME_VERSION,room};}
    return null;
  }
  private pushView(ws:WebSocket,p:Peer){
    if(p.kind==='host'&&!this.authorized(p.hostToken||'')){this.send(ws,'connect_error',{code:'UNAUTHORIZED',message:'請重新登入指揮中心。'});ws.close(1008,'login expired');return;}
    if(!p.path)return;const data=this.view(p.path);this.send(ws,'view',{path:p.path,status:data?200:404,data:data||{error:'這場對戰已關閉，請選擇其他對戰。'}});
  }
  private broadcast(all=true){
    for(const [ws,p] of this.peers){
      if(p.kind==='player'&&p.id){this.send(ws,'room',this.engine.playerView(p.id));if(all)this.send(ws,'lobby',this.engine.lobby());}
      else if(p.kind!=='player')this.pushView(ws,p);
    }
  }
  private active(){return [...this.engine.rooms.values()].some(r=>['playing','countdown','paused'].includes(r.phase));}
  private lastSeen(ws:WebSocket,p:Peer){return Math.max(p.last,this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime()||0);}
  private arm(){if(this.active()&&!this.timer)this.timer=setInterval(()=>this.tick(),100);}
  private tick(){
    this.engine.advance();this.ticks++;
    for(const [ws,p] of this.peers){
      if(Date.now()-this.lastSeen(ws,p)>20000){this.detach(ws);ws.close(1001,'heartbeat timeout');continue;}
      if(p.kind==='player'&&p.id)this.send(ws,'room',this.engine.playerView(p.id));
      else if(this.ticks%5===0)this.pushView(ws,p);
      if(this.ticks%10===0&&p.kind==='player')this.send(ws,'lobby',this.engine.lobby());
    }
    if(!this.active()){clearInterval(this.timer);this.timer=undefined;this.broadcast();this.ctx.waitUntil(this.save());}
    else if(Date.now()-this.savedAt>=5000)this.ctx.waitUntil(this.save());
  }
  async fetch(req:Request):Promise<Response>{
    const url=new URL(req.url),path=url.pathname;this.engine.joinUrl=url.origin;this.engine.advance();
    try{
      if(path.startsWith('/ws/')){
        const kind=path.slice(4);if(!['player','host','spectator'].includes(kind))return json({},404);
        if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({},426);
        if(kind==='host'&&!this.authorized(cookie(req)))return json({error:'請重新登入指揮中心。'},401);
        if(this.peers.size>=96)return json({error:'連線數已達上限。'},503);
        const pair=new WebSocketPair(),[client,ws]=Object.values(pair);const peer:Peer={kind:kind as Peer['kind'],last:Date.now(),window:Date.now(),count:0,hostToken:kind==='host'?cookie(req):undefined};
        this.ctx.acceptWebSocket(ws);ws.serializeAttachment(peer);this.peers.set(ws,peer);await this.ctx.storage.setAlarm(Date.now()+30000);
        return new Response(null,{status:101,webSocket:client});
      }
      if(path==='/host/login'&&req.method==='POST'){
        const raw=await this.body(req);const password=new URLSearchParams(raw).get('password')||'';
        this.auth.attempts=this.auth.attempts.filter(t=>Date.now()-t<60000);
        if(this.auth.attempts.length>=20)return new Response(loginPage(true),{status:429,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Retry-After':'60'}});
        this.auth.attempts.push(Date.now());
        const valid=password.length>=16&&password.length<=256&&timingSafeEqual(hash(password),hash(this.env.HOST_PASSWORD));
        if(!valid){await this.save();return new Response(loginPage(true),{status:401,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});}
        const token=crypto.randomUUID()+crypto.randomUUID();this.auth.sessions=this.auth.sessions.filter(([,t])=>t>Date.now()).slice(-31);this.auth.sessions.push([token,Date.now()+28800000]);await this.save();
        return new Response(null,{status:303,headers:{Location:'/host','Cache-Control':'no-store','Set-Cookie':`__Host-hospital=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`}});
      }
      if(path==='/host/logout'&&req.method==='POST'){
        const token=cookie(req);this.auth.sessions=this.auth.sessions.filter(([t])=>t!==token);await this.save();
        for(const [ws,p]of this.peers)if(p.kind==='host'&&p.hostToken===token){ws.close(1008,'logged out');this.peers.delete(ws);}
        return new Response(null,{status:303,headers:{Location:'/host','Set-Cookie':'__Host-hospital=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}});
      }
      if(path.startsWith('/host')||path.startsWith('/api/host')){
        if(!this.authorized(cookie(req))){if(['/host','/host/','/host.html'].includes(path)&&req.method==='GET')return new Response(loginPage(),{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});return json({error:'請重新登入指揮中心。'},401);}
        if(['/host','/host/','/host.html'].includes(path)&&req.method==='GET'){const asset=new URL('/host',url);const r=await this.env.ASSETS.fetch(new Request(asset));const out=new Response(r.body,r);out.headers.set('Cache-Control','no-store');return out;}
        if(path==='/api/host/state'&&req.method==='GET')return json(this.view(path));
        if(path==='/api/host/action'&&req.method==='POST'){
          if(this.limited('host',60))return json({error:'操作過於頻繁。'},429);
          const a=JSON.parse(await this.body(req));
          if(a.kind==='accepting'&&typeof a.value==='boolean')this.engine.accepting=a.value;
          else if(a.kind==='allow-surrender'&&typeof a.value==='boolean')this.engine.allowSurrender=a.value;
          else if(a.kind==='ultimate-mode'&&typeof a.value==='boolean')this.engine.setUltimateMode(a.value);
          else if(a.kind==='duration')this.engine.setDuration(a.value);
          else if(a.kind==='close'&&typeof a.roomId==='string')this.engine.closeRoom(a.roomId);
          else if(a.kind==='stop'){
            this.engine.accepting=false;this.engine.abortForTunnelRebuild('主持人已結束活動，本局不計勝負。');
            for(const [ws,p]of this.peers)if(p.kind==='player'){this.send(ws,'room',p.id?this.engine.playerView(p.id):null);this.send(ws,'hosting-reset',{reason:'activity-ended'});ws.close(1000,'activity ended');this.peers.delete(ws);}
            this.engine.clearParticipants();
          }else throw new GameError('INVALID','無效主持操作。');
          await this.save();this.broadcast();this.arm();return json({ok:true});
        }
      }
      if(path.startsWith('/api/spectate/rooms')&&req.method==='GET'){const data=this.view(path);return json(data||{error:'找不到對戰。'},data?200:404);}
      return json({error:'Not found'},404);
    }catch(e){return json({error:e instanceof GameError?e.message:'無法完成操作。'},400);}
  }
  private async body(req:Request){const reader=req.body?.getReader();if(!reader)return '';let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new GameError('INVALID','資料過大。');}chunks.push(value);}const all=new Uint8Array(size);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;}return new TextDecoder().decode(all);}
  async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){
    const p=this.peers.get(ws);if(!p)return;
    try{
      if(typeof raw!=='string'||raw.length>4096)throw new GameError('INVALID','資料過大。');
      const now=Date.now();if(now-p.window>=1000){p.window=now;p.count=0;}if(++p.count>60){ws.close(1008,'rate limit');this.detach(ws);return;}p.last=now;
      const m=JSON.parse(raw);ws.serializeAttachment(p);
      if(m.event==='ping'){if(p.kind==='host'&&!this.authorized(p.hostToken||'')){this.send(ws,'connect_error',{code:'UNAUTHORIZED',message:'請重新登入指揮中心。'});ws.close(1008,'login expired');return;}this.send(ws,'pong');return;}
      if(m.event==='hello'){
        if(p.id)throw new GameError('INVALID','已加入。');
        if(p.kind==='player'){
          const token=m.data?.token;if(token!==undefined&&(typeof token!=='string'||token.length>100))throw new GameError('INVALID','無效加入憑證。');
          const s=this.engine.connect(token);
          for(const [old,q]of this.peers)if(old!==ws&&q.id===s.id){this.send(old,'replaced');this.peers.delete(old);old.close(1000,'replaced');}
          p.id=s.id;ws.serializeAttachment(p);await this.save();this.send(ws,'session',s);
        }
        this.send(ws,'connect');this.broadcast();this.arm();return;
      }
      if(m.event==='subscribe'&&p.kind!=='player'){
        const path=m.data?.path;
        if(typeof path!=='string'||(p.kind==='host'?path!=='/api/host/state':!/^\/api\/spectate\/rooms(?:\/[A-Za-z0-9_-]+)?$/.test(path)))throw new GameError('FORBIDDEN','只能觀看戰況。');
        p.path=path;ws.serializeAttachment(p);this.pushView(ws,p);return;
      }
      if(m.event!=='action'||p.kind!=='player'||!p.id)throw new GameError('FORBIDDEN','此連線不能操作遊戲。');
      const kind=m.data?.kind;if(['create','join'].includes(kind)&&this.limited(p.id,20))throw new GameError('RATE_LIMIT','加入房間太頻繁，請稍候。');
      this.engine.action(p.id,m.data);
      if(!['tap','strategy'].includes(kind)){await this.save();this.broadcast();}
      if(m.id)this.send(ws,'ack',{ok:true},m.id);this.arm();
    }catch(e){
      const data={ok:false,code:e instanceof GameError?e.code:'INVALID',message:e instanceof GameError?e.message:'無效操作。'};
      let id;try{id=typeof raw==='string'?JSON.parse(raw).id:undefined;}catch{}
      if(p.kind==='player'&&!p.id){this.send(ws,'connect_error',data);ws.close(1008,'join rejected');this.peers.delete(ws);}
      else if(id)this.send(ws,'ack',data,id);
    }
  }
  private detach(ws:WebSocket){const p=this.peers.get(ws);this.peers.delete(ws);if(p?.id&&!Array.from(this.peers.values()).some(q=>q.id===p.id))this.engine.disconnect(p.id);this.broadcast();this.arm();this.ctx.waitUntil(this.save());}
  webSocketClose(ws:WebSocket){try{ws.close(1000,'closed');}catch{}this.detach(ws);}
  webSocketError(ws:WebSocket){this.webSocketClose(ws);}
  async alarm(){
    for(const [ws,p]of this.peers)if(Date.now()-this.lastSeen(ws,p)>20000||(p.kind==='player'&&!p.id)){this.detach(ws);ws.close(1001,'idle timeout');}
    this.engine.advance();this.broadcast();this.arm();await this.save();
    for(const [key,times]of this.limits)if(times.every(t=>Date.now()-t>60000))this.limits.delete(key);
    if(this.peers.size||this.engine.players.size)await this.ctx.storage.setAlarm(Date.now()+60000);
  }
}
