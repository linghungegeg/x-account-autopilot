// 端到端实测：打开总开关（保持演练模式），观察调度器自主运行。
// 演练模式不会真实提交，但会走完导航 / 生成 / 填表 / 校验的完整流程。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const WATCH_MS = Number(process.env.WATCH_MS) || 4 * 60 * 1000;

const cdp = await connect({ port: PORT });
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(3500);

const errors = [];
popup.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
});
await popup.send('Runtime.enable');

const readPopup = `(() => ({
  status: document.querySelector('#status')?.textContent,
  taskVisible: !document.querySelector('#taskBox')?.hidden,
  taskLabel: document.querySelector('#taskLabel')?.textContent,
  taskStage: document.querySelector('#taskStage')?.textContent,
  taskPercent: document.querySelector('#taskPercent')?.textContent,
  pending: document.querySelector('#pendingCount')?.textContent,
  review: document.querySelector('#reviewCount')?.textContent,
  stats: {
    browse: document.querySelector('#statBrowse')?.textContent,
    like: document.querySelector('#statLike')?.textContent,
    reply: document.querySelector('#statReply')?.textContent,
    follow: document.querySelector('#statFollow')?.textContent
  },
  logs: [...document.querySelectorAll('#logs .log')].map(l => l.textContent.trim()).slice(0, 6),
  queue: [...document.querySelectorAll('#queueList .item')].map(i => i.textContent.trim().slice(0, 70)).slice(0, 5)
}))()`;

console.log('=== 打开总开关前的状态 ===');
console.log(JSON.stringify(await popup.eval(readPopup), null, 2));

// ---------------------------------------------------------------- 放开活跃时段
// 默认 9:00-23:00，现在是凌晨会被正确拦下。start === end 表示不限制。
console.log('\n>>> 临时放开活跃时段（start === end 表示不限制），仅用于本次实测');
const widened = await popup.eval(`
  chrome.runtime.sendMessage({ type: 'SAVE_BEHAVIOR', behavior: { activeHours: { start: 0, end: 0 } } })
    .then(r => JSON.stringify({ ok: r.ok, activeHours: r.state?.behavior?.activeHours, blockReason: r.state?.blockReason }))
`);
console.log(widened);

// ---------------------------------------------------------------- 打开总开关
console.log('\n>>> 打开总开关（演练模式保持开启）');
await popup.eval(`(() => {
  const el = document.querySelector('#enabled');
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(3000);

console.log('开关后状态:', await popup.eval(`document.querySelector('#status')?.textContent`));

// ---------------------------------------------------------------- 观察
console.log(`\n=== 观察 ${Math.round(WATCH_MS / 1000)} 秒（每 10 秒采样一次）===\n`);
const started = Date.now();
let lastLog = '';
let tick = 0;

while (Date.now() - started < WATCH_MS) {
  await sleep(10000);
  tick += 1;
  const state = await popup.eval(readPopup);
  const topLog = state.logs[0] || '';
  const changed = topLog !== lastLog;
  lastLog = topLog;

  const line = [
    `${String(tick * 10).padStart(3)}s`,
    state.taskVisible ? `执行中[${state.taskStage} ${state.taskPercent}]` : '空闲',
    `队列${state.pending}`,
    `今日 浏${state.stats.browse}/赞${state.stats.like}/评${state.stats.reply}/关${state.stats.follow}`
  ].join('  ');
  console.log(line);
  if (changed && topLog) console.log(`        └ ${topLog.slice(0, 110)}`);
}

// ---------------------------------------------------------------- 汇总
console.log('\n=== 最终状态 ===');
console.log(JSON.stringify(await popup.eval(readPopup), null, 2));

// 面板状态
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
if (xTarget) {
  const xPage = await cdp.attach(xTarget);
  const panel = await xPage.eval(`(() => {
    const host = document.getElementById('x-helper-panel-host');
    if (!host?.shadowRoot) return { error: '面板不存在' };
    const sr = host.shadowRoot;
    return {
      handleText: sr.querySelector('.handle-text')?.textContent,
      state: sr.querySelector('.state')?.textContent,
      count: sr.querySelector('.count')?.textContent,
      taskVisible: !sr.querySelector('.task')?.hidden,
      taskLabel: sr.querySelector('.task-label')?.textContent,
      stage: sr.querySelector('.stage')?.textContent,
      percent: sr.querySelector('.percent')?.textContent,
      queueItems: sr.querySelectorAll('[data-pane="queue"] .qitem').length,
      logItems: sr.querySelectorAll('[data-pane="logs"] .log').length
    };
  })()`);
  console.log('\n=== X 页面面板 ===');
  console.log(JSON.stringify(panel, null, 2));
}

if (errors.length) console.log('\n弹窗报错:', errors);
process.exit(0);
