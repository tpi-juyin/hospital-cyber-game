// Native WebSocket adapter: sends immediately and never queues offline actions.
type Callback = (...args: any[]) => void;
export class GameSocket {
  auth: {token?: string};
  private ws?: WebSocket;
  private listeners = new Map<string, Callback[]>();
  private pending = new Map<number, {fn: Callback; timer: ReturnType<typeof setTimeout>}>();
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private wanted=false; private ready=false; private serial=0; private received=0;
  constructor(options: {auth?: {token?:string}}, private path='/ws/player') { this.auth=options.auth||{}; }
  on(event:string, fn:Callback) { this.listeners.set(event,[...(this.listeners.get(event)||[]),fn]); return this; }
  private fire(event:string,value?:any) { for(const fn of this.listeners.get(event)||[])fn(value); }
  get volatile() { return this; }
  timeout(ms:number) { return {emit: (event:string,value:unknown,fn:Callback)=>this.send(event,value,(r:any)=>r?.code==='TRANSPORT' ? fn(new Error('Disconnected')) : fn(null,r),ms)}; }
  emit(event:string,value:unknown,fn?:Callback) { this.send(event,value,fn,5000); }
  private send(event:string,value:unknown,fn?:Callback,ms=5000) {
    if(!this.ready || this.ws?.readyState!==WebSocket.OPEN) { fn?.({ok:false,code:'TRANSPORT',message:'連線中斷，請重試。'});return; }
    const id=++this.serial;
    if(fn)this.pending.set(id,{fn,timer:setTimeout(()=>{this.pending.delete(id);fn({ok:false,code:'TRANSPORT'});},ms)});
    this.ws.send(JSON.stringify({event,data:value,id:fn?id:undefined}));
  }
  connect() {
    this.wanted=true;clearTimeout(this.retry);clearInterval(this.heartbeat);
    const old=this.ws;this.ws=undefined;old?.close();this.ready=false;
    const url=new URL(this.path,location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    const ws=this.ws=new WebSocket(url);this.received=Date.now();
    ws.onopen=()=>{if(this.ws!==ws)return;ws.send(JSON.stringify({event:'hello',data:this.auth}));this.heartbeat=setInterval(()=>{if(Date.now()-this.received>15000)ws.close();else if(ws.readyState===WebSocket.OPEN)ws.send('ping');},5000);};
    ws.onmessage=e=>{
      if(this.ws!==ws)return;this.received=Date.now();if(e.data==='pong')return;let m:any;try{m=JSON.parse(e.data);}catch{return;}
      if(m.event==='ack'){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);p.fn(m.data);}return;}
      if(m.event==='connect')this.ready=true;
      if(m.event==='connect_error'){const err=Object.assign(new Error(m.data.message),{data:{code:m.data.code}});this.fire('connect_error',err);return;}
      this.fire(m.event,m.data);
    };
    ws.onclose=()=>{if(this.ws!==ws)return;this.ready=false;clearInterval(this.heartbeat);for(const p of this.pending.values()){clearTimeout(p.timer);p.fn({ok:false,code:'TRANSPORT'});}this.pending.clear();this.fire('disconnect');if(this.wanted)this.retry=setTimeout(()=>this.connect(),1500);};
    ws.onerror=()=>{};
    return this;
  }
  disconnect(){this.wanted=false;clearTimeout(this.retry);clearInterval(this.heartbeat);this.ws?.close();return this;}
}
export const io=(options:any)=>new GameSocket(options);

// Existing render loops read the pushed snapshot locally, not by HTTP polling.
export function pushedFetch(kind:'host'|'spectator') {
  const socket=new GameSocket({},`/ws/${kind}`);let connected=false,path='',latest:any,unauthorized=false;
  const waiters=new Set<()=>void>();let starting=false;
  const notify=()=>{for(const fn of waiters)fn();};
  socket.on('connect',()=>{connected=true;latest=undefined;if(path)socket.emit('subscribe',{path});notify();});
  socket.on('disconnect',()=>{connected=false;latest=undefined;notify();});
  socket.on('view',(v:any)=>{if(v.path===path){latest=v;notify();}});
  socket.on('connect_error',(e:any)=>{if(e.data?.code==='UNAUTHORIZED'){unauthorized=true;socket.disconnect();notify();}});
  const start=async()=>{if(starting)return;starting=true;if(kind==='host'){try{const r=await fetch('/api/host/state');if(r.status===401){unauthorized=true;notify();return;}}catch{}}socket.connect();};
  window.addEventListener('pagehide',()=>socket.disconnect());
  window.addEventListener('pageshow',e=>{if(e.persisted){starting=false;void start();}});
  return async (url:string,options?:RequestInit):Promise<Response>=>{
    void start();
    if(path!==url){path=url;latest=undefined;if(connected)socket.emit('subscribe',{path});}
    const requested=url;
    if(!latest&&!unauthorized)await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);waiters.delete(check);options?.signal?.removeEventListener('abort',abort);};
      const check=()=>{if(unauthorized||latest||path!==requested){cleanup();resolve();}};
      const abort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('連線中斷'));},4000);
      waiters.add(check);options?.signal?.addEventListener('abort',abort,{once:true});if(options?.signal?.aborted)abort();else check();
    });
    if(unauthorized)return new Response('{}',{status:401});
    if(!connected||!latest||path!==requested)throw new Error('戰況連線中斷');
    return Response.json(latest.data,{status:latest.status||200});
  };
}

export const persistentActivity = true;
