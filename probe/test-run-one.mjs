// 短测：点「立即执行一条」，观察任务执行的完整链路（演练模式，不会真提交）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const WATCH_S = Number(process.env.WATCH_S) || 60;

const cdp = await connect({ port: PORT });
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(3000);

const read = `(() => ({
  status: document.querySelector('#status')?.textContent,
  running: !document.querySelector('#taskBox')?.hidden,
  label: document.querySelector('#taskLabel')?.textContent,
  stage: document.querySelector('#taskStage')?.textContent,
  pct: document.querySelector('#taskPercent')?.textContent,
  pending: document.querySelector('#pendingCount')?.textContent,
  logs: [...document.querySelectorAll('#logs .log')].map(l => l.textContent.trim()).slice(0, 3)
}))()`;

console.log('>>> 点「立即执行一条」');
await popup.eval(`document.querySelector('#runNow').click()`);

const started = Date.now();
let lastStage = '';
while (Date.now() - started < WATCH_S * 1000) {
  await sleep(3000);
  const s = await popup.eval(read);
  const elapsed = Math.round((Date.now() - started) / 1000);
  const stage = `${s.stage} ${s.pct}`;
  if (stage !== lastStage || !s.running) {
    console.log(`  ${String(elapsed).padStart(2)}s  ${s.running ? `执行中: ${s.label} | ${stage}` : '空闲'}  队列=${s.pending}`);
    lastStage = stage;
  }
  if (!s.running && elapsed > 8) break;
}

console.log('\n=== 日志 ===');
const s = await popup.eval(read);
s.logs.forEach(l => console.log('  ' + l));

// 工作标签页现在停在哪
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('\n=== x.com 标签页 ===');
targets.filter(t => t.type === 'page' && t.url.includes('x.com')).forEach(t => console.log('  ' + t.url));

process.exit(0);
