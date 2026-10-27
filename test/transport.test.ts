import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('Cloudflare transport sends immediately, correlates replies and never replays offline taps', async t => {
  const w = new Window({ url: 'https://game.example/', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  t.after(() => w.happyDOM.close());
  const output = await build({ entryPoints: ['src/client/transport-cloudflare.ts'], bundle: true, write: false, format: 'iife', globalName: 'transport', platform: 'browser' });
  w.eval(`
    window.framesSent = []; window.replies = [];
    window.WebSocket = class {
      static OPEN = 1; readyState = 0;
      constructor(url) { this.url = url; window.latestWire = this; }
      send(frame) { window.framesSent.push(frame); }
      close() { this.readyState = 3; this.onclose?.(); }
    };
    ${output.outputFiles[0].text}
    window.game = transport.io({auth:{token:'private-test-token'}});
    game.connect();
    game.emit('action', {kind:'tap',seq:1}, r => replies.push(r));
  `);
  assert.equal(w.eval('framesSent.length'), 0, 'offline input is not queued');
  assert.equal(w.eval('replies[0].code'), 'TRANSPORT');
  assert.equal(w.eval('String(latestWire.url)'), 'wss://game.example/ws/player');
  w.eval(`latestWire.readyState=1;latestWire.onopen();latestWire.onmessage({data:JSON.stringify({event:'connect'})});`);
  assert.equal(w.eval('framesSent.length'), 1, 'only the hello frame was sent');
  w.eval(`game.timeout(5000).emit('action',{kind:'tap',seq:2},(err,r)=>replies.push({error:!!err,...r}));`);
  assert.equal(w.eval('framesSent.length'), 2, 'online tap sent synchronously');
  const tap = JSON.parse(w.eval('framesSent[1]'));
  assert.equal(tap.data.seq, 2);
  w.eval(`latestWire.onmessage({data:JSON.stringify({event:'ack',id:${tap.id},data:{ok:true}})});`);
  assert.equal(w.eval('replies[1].ok'), true);
  assert.equal(w.eval('replies[1].error'), false);
  w.eval(`game.emit('action',{kind:'tap',seq:3},r=>replies.push(r));game.disconnect();`);
  assert.equal(w.eval('replies[2].code'), 'TRANSPORT', 'pending callback is settled on disconnect');
  w.eval(`game.connect();latestWire.readyState=1;latestWire.onopen();latestWire.onmessage({data:JSON.stringify({event:'connect'})});game.disconnect();`);
  assert.equal(w.eval(`framesSent.filter(s=>JSON.parse(s).event==='action').length`), 2, 'reconnect does not replay inputs');
});
