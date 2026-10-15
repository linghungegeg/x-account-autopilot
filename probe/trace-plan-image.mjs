// 观测调度器路径下的带图发帖：实时抓埋点，看它到底停在哪。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const LEAD_MINUTES = Number(process.env.LEAD_MINUTES) || 2;

const cdp = await connect({ port: PORT });

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTab = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
if (!xTab) { console.log('没有 x.com 标签页'); process.exit(1); }
const xPage = await cdp.attach(xTab);

const traces = [];
xPage.on(msg => {
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (text.includes('[x-probe]')) {
      const line = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${text}`;
      traces.push(line);
      console.log('    ' + line);
    }
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    console.log('    EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || '').slice(0, 250));
  }
});
await xPage.send('Runtime.enable');

const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);
const ev = (expr, timeoutMs = 300000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 300000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);
const readState = async () => JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    current: r.state.current,
    postCountToday: r.state.postCountToday,
    items: r.state.postPlan.items.map(i => ({ status: i.status, href: i.statusHref, error: i.error })),
    logs: r.state.logs.slice(0, 3).map(l => l.tag + ' | ' + l.message.slice(0, 70))
  }))
`));

// ---------------------------------------------------------------- 准备
console.log('>>> 准备');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_COOLDOWN' });
await call({ type: 'CLEAR_SEEN' });
await call({ type: 'SAVE_KEYWORDS', keywords: [] });   // 清空关键词，避免调度器去 refill 互动任务
await call({ type: 'SAVE_BEHAVIOR', behavior: {
  dryRun: true,                     // 先演练，只看流程不真发
  perAction: { browse: { maxPerHour: 15, maxPerDay: 80 }, like: { maxPerHour: 10, maxPerDay: 60 }, reply: { maxPerHour: 4, maxPerDay: 20 }, follow: { maxPerHour: 6, maxPerDay: 30 }, post: { maxPerHour: 5, maxPerDay: 10 } },
  maxPerHour: 30, maxPerDay: 200
} });

// 清掉非 pending 条目，只留一条
const all = JSON.parse(await ev(`chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(r.state.postPlan.items.map(i => ({ id: i.id, status: i.status }))))`));
for (const item of all.filter(i => i.status !== 'pending')) await call({ type: 'DELETE_POST_ITEM', id: item.id });
let ids = all.filter(i => i.status === 'pending').map(i => i.id);
while (ids.length > 1) await call({ type: 'DELETE_POST_ITEM', id: ids.pop() });
if (!ids.length) {
  await call({ type: 'GENERATE_POSTS', mode: 'translate', sources: ['把重复的事情自动化掉，省下来的时间才是自己的。'], language: 'en' });
  ids = JSON.parse(await ev(`chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(r.state.postPlan.items.filter(i => i.status === 'pending').map(i => i.id)))`));
}
console.log('待发条目:', ids.length);

const target = new Date(Date.now() + LEAD_MINUTES * 60 * 1000);
const hhmm = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
console.log(`现在 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}，时间点=${hhmm}，配图=总是，演练模式`);

console.log(await call({
  type: 'SAVE_POST_PLAN',
  plan: { enabled: true, scheduledTimes: [hhmm], windowStart: 0, windowEnd: 0, dailyLimit: 5, language: 'en', withImage: 'always', imageChance: 1, maxWeight: 280 }
}));

await call({ type: 'SET_ENABLED', enabled: true });

// ---------------------------------------------------------------- 观察
console.log('\n=== 观察（埋点会实时打出来）===');
const deadline = Date.now() + (LEAD_MINUTES + 6) * 60 * 1000;
let lastTraceCount = 0;
while (Date.now() < deadline) {
  await sleep(10000);
  const s = await readState();
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`  ${time}  ${s.current ? `${s.current.stage} ${s.current.progress}%` : '空闲'}  今日 ${s.postCountToday}  ${s.logs[0]?.slice(0, 55) || ''}`);
  const done = s.items.find(i => i.status === 'published');
  const failed = s.items.find(i => i.status === 'failed');
  if (done) { console.log('  ✅ 已发布'); break; }
  if (failed) { console.log('  ❌ 失败:', failed.error); break; }
  if (traces.length > lastTraceCount) lastTraceCount = traces.length;
  else if (s.current && Date.now() - deadline > -5 * 60 * 1000) {
    // 有任务在跑但没新埋点，说明卡在进 postToX 之前
  }
}

console.log('\n=== 埋点时间线 ===');
traces.forEach(t => console.log('  ' + t));

console.log('\n>>> 收尾');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } });
await call({ type: 'SAVE_KEYWORDS', keywords: ['独立开发者'] });

process.exit(0);
