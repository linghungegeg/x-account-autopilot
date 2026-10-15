// 验证发帖计划的完整闭环：设一个 2 分钟后的时间点 -> 等调度触发 -> 真发出去（带图）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const LEAD_MINUTES = Number(process.env.LEAD_MINUTES) || 2;

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

const ev = (expr, timeoutMs = 180000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 180000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);
const readState = async () => JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    plan: r.state.postPlan,
    enabled: r.state.behavior.enabled,
    dryRun: r.state.behavior.dryRun,
    current: r.state.current,
    lastPostAt: r.state.lastPostAt,
    postCountToday: r.state.postCountToday,
    logs: r.state.logs.slice(0, 6).map(l => l.tag + ' | ' + l.message.slice(0, 90))
  }))
`));

// ---------------------------------------------------------------- 设定时间点
// 先清空互动队列：这次只验证发帖计划本身，不要让普通任务也真跑一遍
console.log('清空队列:', await call({ type: 'CLEAR_QUEUE' }));

const target = new Date(Date.now() + LEAD_MINUTES * 60 * 1000);
const hhmm = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
console.log(`现在 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}，把时间点设成 ${hhmm}`);

console.log(await call({
  type: 'SAVE_POST_PLAN',
  plan: {
    enabled: true,
    mode: 'scheduled',
    scheduledTimes: [hhmm],
    dailyLimit: 3,
    language: 'en',
    withImage: 'always',   // 这次连配图一起验证
    imageChance: 1,
    maxWeight: 280
  }
}));

const before = await readState();
console.log('待发条目:', before.plan.items.filter(i => i.status === 'pending').map(i => i.text.slice(0, 50)));

// ---------------------------------------------------------------- 放实弹
console.log('\n>>> 关掉演练模式 + 打开总开关');
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: false } });
await call({ type: 'SET_ENABLED', enabled: true });

// ---------------------------------------------------------------- 等触发
console.log('\n=== 等待调度触发（每分钟一轮）===');
let published = null;
const deadline = Date.now() + (LEAD_MINUTES + 6) * 60 * 1000;

while (Date.now() < deadline) {
  await sleep(15000);
  const state = await readState();
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const done = state.plan.items.find(i => i.status === 'published');
  const failed = state.plan.items.find(i => i.status === 'failed');
  const running = state.current ? `执行中:${state.current.label} ${state.current.stage} ${state.current.progress}%` : '空闲';
  console.log(`  ${time}  ${running}  今日已发 ${state.postCountToday}  ${state.logs[0]?.slice(0, 70) || ''}`);
  if (done) { published = done; break; }
  if (failed) { console.log('  ❌ 有失败条目:', failed.error); break; }
}

// ---------------------------------------------------------------- 结果
console.log('\n=== 结果 ===');
const after = await readState();
console.log('计划条目状态:', after.plan.items.map(i => ({ status: i.status, weight: i.weight, href: i.statusHref, error: i.error })));
console.log('今日已发:', after.postCountToday, '| lastPostAt:', after.lastPostAt ? new Date(after.lastPostAt).toLocaleTimeString('zh-CN', { hour12: false }) : 0);
console.log('\n最近日志:');
after.logs.forEach(l => console.log('  ' + l));

if (published?.statusHref) {
  console.log(`\n✅ 发布成功：https://x.com${published.statusHref}`);
  console.log(`   内容：${published.text}`);
} else {
  console.log('\n⚠️ 没有条目变成已发布');
}

// ---------------------------------------------------------------- 收尾
console.log('\n>>> 收尾：关总开关 + 关计划');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } });
await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } });

process.exit(0);
