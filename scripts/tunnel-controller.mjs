// One tunnel at a time. Epoch checks prevent old output/health probes publishing a stale URL.
export function createTunnelController({ spawnTunnel, terminate, health, publish, log, record, now = Date.now, every = setInterval, cancel = clearInterval }) {
  let child, timer, epoch = 0, generation = 0, stopped = false;
  let candidate = '', publicUrl = '', checking = false, failures = 0, deadline = 0;
  function clearTimer() { if (timer) cancel(timer); timer = undefined; }
  function fail(at, message) {
    if (at !== epoch || stopped) return;
    const previous = child; child = undefined; ++epoch; clearTimer(); candidate = ''; publicUrl = '';
    log(message); publish(message, '', generation, 'failed');
    // A retry must wait for this cleanup too, so processes never overlap.
    cleanup = cleanup.then(() => terminate(previous));
  }
  let cleanup = Promise.resolve();
  async function reconcile(at) {
    if (at !== epoch || stopped || checking) return;
    if (now() >= deadline && !publicUrl) { fail(at, '公開連線建立逾時，請檢查網路／TCP 7844 後按「重試公開連線」。'); return; }
    checking = true;
    const url = candidate;
    try {
      const ok = !!url && await health(url);
      if (at !== epoch || stopped || url !== candidate) return;
      if (ok) {
        failures = 0;
        if (publicUrl !== url) log(`公開入口已就緒：${url}`);
        publicUrl = url; deadline = Infinity;
        publish('公開入口已就緒 · 請玩家掃描目前的 QR Code 加入', url, generation, 'ready');
      } else if (++failures >= 2 || !publicUrl) {
        if (publicUrl) deadline = now() + 120_000;
        publicUrl = '';
        publish(candidate ? '正在等待 DNS 與公開連線就緒；請確認網路及 TCP 7844。' : '正在建立公開連線…', '', generation, 'connecting');
      }
    } catch { if (at === epoch) fail(at, '公開入口檢查失敗，請確認網路後重試。'); }
    finally { if (at === epoch) checking = false; }
  }
  async function restart(nextGeneration = 0) {
    if (stopped) return;
    const at = ++epoch; generation = nextGeneration; clearTimer();
    const previous = child; child = undefined;
    candidate = ''; publicUrl = ''; checking = false; failures = 0; deadline = now() + 120_000;
    publish('正在重建公開連線…', '', generation, 'connecting');
    cleanup = cleanup.then(() => terminate(previous));
    await cleanup;
    if (stopped || at !== epoch) return;
    try {
      const current = spawnTunnel(); child = current; let tail = '';
      const receive = chunk => {
        if (at !== epoch || stopped) return;
        const text = chunk.toString(); record(text); tail = (tail + text).slice(-8192);
        const matches = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/g);
        if (matches?.length) { candidate = matches.at(-1); void reconcile(at); }
      };
      current.stdout.on('data', receive); current.stderr.on('data', receive);
      current.once('error', error => fail(at, `公開連線工具無法執行（${error.code || error.message}），請檢查主持包後重試。`));
      current.once('exit', () => fail(at, '公開通道已停止，請按「重試公開連線」。'));
      timer = every(() => void reconcile(at), 5000);
    } catch (error) { fail(at, `公開連線無法建立：${error.message}。請檢查後重試。`); }
  }
  async function stop() {
    stopped = true; ++epoch; clearTimer();
    const previous = child; child = undefined;
    cleanup = cleanup.then(() => terminate(previous)); await cleanup;
  }
  return { restart, stop };
}
