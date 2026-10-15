// 验证改后的语义：指定时间留空 -> 按时间段随机发。
// 把时间段设成全天，它应该在下一轮 tick（约 1 分钟）就发出去。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

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
    enabled: r.state.behavior.enabled,
    current: r.state.current,
    postCountToday: r.state.postCountToday,
    lastPostAt: r.state.lastPostAt,
    items: r.state.postPlan.items.map(i => ({ status: i.status, href: i.statusHref, error: i.error, text: i.text.slice(0, 45) })),
    logs: r.state.logs.slice(0, 5).map(l => l.tag + ' | ' + l.message.slice(0, 80))
  }))
`));

console.log('>>> 清空队列 + 清冷却 + 清掉历史失败条目 + 设定计划');
console.log(await call({ type: 'CLEAR_QUEUE' }));
// 之前测试累积的连续失败会触发冷却，先清掉
console.log('清冷却:', await call({ type: 'CLEAR_COOLDOWN' }));

// 失败的条目不会自动重试，先删掉，否则测试一看到 failed 就退出
const stale = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(
    r.state.postPlan.items.filter(i => i.status === 'failed').map(i => i.id)
  ))
`));
for (const id of stale) await call({ type: 'DELETE_POST_ITEM', id });
if (stale.length) console.log(`  清掉 ${stale.length} 条历史失败`);

console.log(await call({
  type: 'SAVE_POST_PLAN',
  plan: {
    enabled: true,
    scheduledTimes: [],      // 留空 -> 走时间段随机
    windowStart: 0,
    windowEnd: 0,            // 起止相同 = 全天
    dailyLimit: 3,
    language: 'en',
    withImage: 'off',        // 这次不配图，专心验证发布闭环
    maxWeight: 280
  }
}));

const before = await readState();
console.log('待发条目:', before.items.filter(i => i.status === 'pending').map(i => i.text));

console.log('\n>>> 关演练 + 开总开关');
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: false } });
await call({ type: 'SET_ENABLED', enabled: true });

console.log('\n=== 等待发布 ===');
let published = null;
const deadline = Date.now() + 4 * 60 * 1000;
while (Date.now() < deadline) {
  await sleep(10000);
  const s = await readState();
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const done = s.items.find(i => i.status === 'published');
  const failed = s.items.find(i => i.status === 'failed');
  console.log(`  ${time}  ${s.current ? `执行中:${s.current.stage} ${s.current.progress}%` : '空闲'}  今日已发 ${s.postCountToday}  ${s.logs[0]?.slice(0, 65) || ''}`);
  if (done) { published = done; break; }
  if (failed) { console.log('  ❌ 失败:', failed.error); break; }
}

const after = await readState();
console.log('\n=== 结果 ===');
console.log('条目:', after.items);
console.log('今日已发:', after.postCountToday, '| lastPostAt:', after.lastPostAt ? new Date(after.lastPostAt).toLocaleTimeString('zh-CN', { hour12: false }) : 0);
console.log('\n日志:');
after.logs.forEach(l => console.log('  ' + l));

if (published?.href) {
  console.log(`\n✅ 发布成功：https://x.com${published.href}`);
  console.log(`   ${published.text}`);
} else {
  console.log('\n⚠️ 没有条目变成已发布');
}

console.log('\n>>> 收尾：关总开关 + 回演练模式 + 关计划');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } });
await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } });

process.exit(0);
