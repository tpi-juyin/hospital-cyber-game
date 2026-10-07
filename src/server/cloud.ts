import { startServers } from './index.js';
const origin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
const port = Number(process.env.PORT || 10000);
startServers({ cloud: { origin, password: process.env.HOST_PASSWORD || '', port } }).then(server => {
  console.log(`遊戲入口：${origin}\n指揮中心入口：${origin}/host`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await server.stop(); process.exit(0); };
  process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop());
}).catch(error => { console.error('雲端服務啟動失敗：', error.message); process.exit(1); });
