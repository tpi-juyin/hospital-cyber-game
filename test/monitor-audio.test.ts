import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { MonitorAudio } from '../src/client/monitor-audio';
import { BattleAudio, type AudioState } from '../src/client/audio';
import { Engine } from '../src/server/engine';

test('monitor audio follows defense only, suppresses backlog, separates preferences and stops on exit', async t => {
 const w=new Window();t.after(()=>w.happyDOM.close());
 const root=w.document.createElement('div');w.document.body.append(root);
 const events: unknown[][]=[];let state:AudioState;
 const fake={configure(s:AudioState){state=s;},unlock:async()=>{},isRunning:()=>true,action:(...a:unknown[])=>events.push(['action',...a]),outcome:(won:boolean)=>events.push(['outcome',won]),countdown:(n:number)=>events.push(['countdown',n])};
 const m=new MonitorAudio(root as unknown as HTMLElement,fake as unknown as BattleAudio);root.innerHTML=m.controls();m.connection(true);m.enter();assert.equal(state!.visible,true);
 const e=new Engine(),p=e.connect();e.action(p.id,{kind:'create',mode:'solo',role:'defense',duration:60});const r=e.playerView(p.id)!;
 r.phase='playing';r.remainingMs=20000;const d=r.members.find(m=>m.role==='defense')!,a=r.members.find(m=>m.role==='attack')!;
 d.stats.taps=50;m.update(r);assert.equal(events.length,0);assert.equal(state!.battle,true);
 a.stats.taps++;m.update(r);assert.equal(events.length,0);
 d.stats.taps+=3;m.update(r);assert.equal(events.length,1);assert.deepEqual(events[0],['action','defense',d.strategy,true]);
 r.remainingMs=9000;m.update(r);assert.equal(state!.urgent,true);
 root.querySelector<import("happy-dom").HTMLButtonElement>('[data-monitor-audio="music"]')!.click();assert.equal(state!.music,false);assert.equal(state!.effects,true);
 root.querySelector<import("happy-dom").HTMLButtonElement>('[data-monitor-audio="effects"]')!.click();assert.equal(state!.effects,false);assert.equal(state!.music,false);
 r.phase='ended';r.winner='attack';m.update(r);m.update(r);assert.deepEqual(events.at(-1),['outcome',false]);assert.equal(events.filter(x=>x[0]==='outcome').length,1);
 m.leave();assert.equal(state!.visible,false);assert.equal(state!.battle,false);
 events.length=0;m.enter();m.update(r);assert.equal(events.length,0,'no result on joining ended room');
 r.phase='playing';m.update(r);m.connection(true);assert.equal(state!.visible,false);d.stats.taps+=30;m.update(r);assert.equal(events.length,0,'no catch-up after stale connection');
 r.phase='countdown';r.remainingMs=3000;m.update(r);r.remainingMs=2000;m.update(r);r.phase='playing';m.update(r);assert.deepEqual(events.slice(-2),[['countdown',2],['countdown',0]]);
 m.leave();
});

test('host lobby uses normal music only and restores it after room playback', t => {
 const w=new Window();t.after(()=>w.happyDOM.close());
 let state:AudioState;
 const fake={configure(s:AudioState){state=s;},unlock:async()=>{},isRunning:()=>true};
 const m=new MonitorAudio(w.document.body as unknown as HTMLElement,fake as unknown as BattleAudio);
 m.lobby(true);assert.equal(state!.battle,true);assert.equal(state!.urgent,false);assert.equal(state!.effects,false);
 const e=new Engine(),p=e.connect();e.action(p.id,{kind:'create',mode:'solo',role:'defense',duration:60});const r=e.playerView(p.id)!;
 r.phase='playing';r.remainingMs=9000;m.enter();m.update(r);
 assert.equal(state!.urgent,true);assert.equal(state!.effects,true);
 m.leave();assert.equal(state!.battle,true);assert.equal(state!.urgent,false);assert.equal(state!.effects,false);
 m.connection(true);assert.equal(state!.visible,false);m.connection(false);assert.equal(state!.visible,true);
 m.lobby(false);assert.equal(state!.visible,false);
});

test('observed taps are paced, canceled on mute/exit and never replay a network gap', t => {
 t.mock.timers.enable({apis:['setTimeout']});
 const w=new Window();t.after(()=>w.happyDOM.close());
 let taps=0;const fake={configure(){},unlock:async()=>{},isRunning:()=>true,action(){taps++},outcome(){},countdown(){}};
 const root=w.document.body;const m=new MonitorAudio(root as unknown as HTMLElement,fake as unknown as BattleAudio);root.innerHTML=m.controls();m.enter();
 const e=new Engine(),p=e.connect();e.action(p.id,{kind:'create',mode:'solo',role:'defense',duration:60});const r=e.playerView(p.id)!;r.phase='playing';r.remainingMs=20000;
 const d=r.members.find(m=>m.role==='defense')!;m.update(r);d.stats.taps+=3;r.remainingMs-=500;m.update(r);
 assert.equal(taps,1);t.mock.timers.tick(170);assert.equal(taps,2);t.mock.timers.tick(170);assert.equal(taps,3);
 d.stats.taps+=3;r.remainingMs-=500;m.update(r);assert.equal(taps,4);m.leave();t.mock.timers.tick(1000);assert.equal(taps,4);
 m.enter();m.update(r);d.stats.taps+=6;r.remainingMs-=3000;m.update(r);t.mock.timers.tick(1000);assert.equal(taps,4);
 d.stats.taps+=3;r.remainingMs-=500;m.update(r);assert.equal(taps,5);
 root.querySelector<import('happy-dom').HTMLButtonElement>('[data-monitor-audio="effects"]')!.click();t.mock.timers.tick(1000);assert.equal(taps,5);
 m.leave();
});

test('host attempts autoplay, preserves mute across reload and lets blocked audio be muted', t=>{
 const w=new Window();t.after(()=>w.happyDOM.close());const root=w.document.body;const calls:boolean[]=[];let state:AudioState;
 const fake={configure(s:AudioState){state=s},unlock:async(retry:boolean)=>{calls.push(retry)},isRunning:()=>false};
 const m=new MonitorAudio(root as unknown as HTMLElement,fake as unknown as BattleAudio);root.innerHTML=m.controls();m.lobby(true);
 assert.deepEqual(calls,[false]);assert.equal(root.querySelector('[data-monitor-audio-hint]'),null);
 m.activate();assert.deepEqual(calls,[false,true]);
 root.querySelector<import('happy-dom').HTMLButtonElement>('[data-monitor-audio="music"]')!.click();assert.equal(state!.music,false);
 calls.length=0;const next=new MonitorAudio(w.document.createElement('div') as unknown as HTMLElement,fake as unknown as BattleAudio);next.lobby(true);
 assert.equal(state!.music,false);assert.equal(calls.length,0,'stored mute must suppress autoplay');m.leave();next.lobby(false);
});
