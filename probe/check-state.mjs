// 读后台完整状态 + service worker 的控制台报错。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });

// ---------------------------------------------------------------- 后台状态
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(2500);

const state = await popup.eval(`chrome.runtime.sendMessage({type:'GET_ALL'}).then(r => JSON.stringify({
  enabled: r.state.behavior.enabled,
  dryRun: r.state.behavior.dryRun,
  current: r.state.current,
  nextRunInMs: r.state.nextRunInMs,
  blockReason: r.state.blockReason,
  challenge: r.state.challenge,
  pending: r.state.pendingCount,
  queueLen: r.state.queue.length,
  stats: r.state.stats.total,
  lastBlock: r.state.lastBlockReason,
  logs: r.state.logs.slice(0, 12).map(l => (l.tag || '?') + ' | ' + l.level + ' | ' + l.message.slice(0, 90))
}, null, 2))`);
console.log('=== 后台状态 ===');
console.log(state);

// ---------------------------------------------------------------- SW 报错
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sw = targets.find(t => t.type === 'service_worker' && t.url.includes('service-worker.js'));
if (sw) {
  console.log('\n=== Service Worker 控制台 ===');
  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  await sleep(1500);
  // 主动求值，看 SW 是否还能响应
  ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: 'typeof chrome.alarms', returnByValue: true } }));
  await sleep(1500);
  console.log(logs.length ? logs.slice(0, 15).join('\n') : '  （没有新的控制台输出）');
  ws.close();
} else {
  console.log('\n⚠️ Service Worker 没在跑（休眠或被终止）');
}

process.exit(0);
