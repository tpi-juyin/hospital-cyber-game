import test from 'node:test';import assert from 'node:assert/strict';import {Engine} from '../src/server/engine';
test('durable snapshot preserves host settings, private reconnect identity and used room codes',()=>{
 const a=new Engine(()=>1000);a.joinUrl='https://example.test';a.setDuration(90);a.allowSurrender=true;
 const p=a.connect();a.action(p.id,{kind:'name',name:'測試'});a.action(p.id,{kind:'create',mode:'duo',role:'attack'});
 const room=a.playerView(p.id)!;const b=new Engine(()=>1500);b.restore(structuredClone(a.snapshot()));
 assert.equal(b.connect(p.token).id,p.id);assert.equal(b.lobby().defaultDuration,90);assert.equal(b.lobby().allowSurrender,true);assert.equal(b.lobby().joinUrl,a.joinUrl);assert.equal(b.playerView(p.id)?.code,room.code);
 b.closeRoom(room.id);b.action(p.id,{kind:'create',mode:'duo',role:'defense'});assert.notEqual(b.playerView(p.id)?.code,room.code);
});
