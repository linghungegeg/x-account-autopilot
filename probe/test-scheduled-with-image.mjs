// 最后两项：定时时间点模式的完整发布 + 发帖计划带图。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const LEAD_MINUTES = Number(process.env.LEAD_MINUTES) || 2;

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 200000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 200000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);
const readState = async () => JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    dryRun: r.state.behavior.dryRun,
    current: r.state.current,
    postCountToday: r.state.postCountToday,
    items: r.state.postPlan.items.map(i => ({ status: i.status, href: i.statusHref, error: i.error, text: i.text.slice(0, 45) })),
    logs: r.state.logs.slice(0, 4).map(l => l.tag + ' | ' + l.message.slice(0, 70))
  }))
`));

// ---------------------------------------------------------------- 准备
console.log('>>> 准备：清队列/冷却/已处理/失败条目');
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_COOLDOWN' });
await call({ type: 'CLEAR_SEEN' });

const stale = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(
    r.state.postPlan.items.filter(i => i.status !== 'pending').map(i => i.id)
  ))
`));
for (const id of stale) await call({ type: 'DELETE_POST_ITEM', id });

// 只留一条，方便观察
let items = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(
    r.state.postPlan.items.filter(i => i.status === 'pending').map(i => i.id)
  ))
`));
while (items.length > 1) {
  await call({ type: 'DELETE_POST_ITEM', id: items.pop() });
}

const target = new Date(Date.now() + LEAD_MINUTES * 60 * 1000);
const hhmm = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
console.log(`现在 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}，时间点设为 ${hhmm}，配图=总是`);

console.log(await call({
  type: 'SAVE_POST_PLAN',
  plan: {
    enabled: true,
    scheduledTimes: [hhmm],     // 指定时间点模式
    windowStart: 0,
    windowEnd: 0,
    dailyLimit: 3,
    language: 'en',
    withImage: 'always',        // 带图
    imageChance: 1,
    maxWeight: 280
  }
}));

const before = await readState();
console.log('待发:', before.items.filter(i => i.status === 'pending').map(i => i.text));

console.log('\n>>> 关演练 + 开总开关');
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: false } });
await call({ type: 'SET_ENABLED', enabled: true });

// ---------------------------------------------------------------- 等待
console.log('\n=== 等待到点发布 ===');
let published = null;
const deadline = Date.now() + (LEAD_MINUTES + 7) * 60 * 1000;
while (Date.now() < deadline) {
  await sleep(15000);
  const s = await readState();
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const done = s.items.find(i => i.status === 'published');
  const failed = s.items.find(i => i.status === 'failed');
  console.log(`  ${time}  ${s.current ? `执行中:${s.current.stage} ${s.current.progress}%` : '空闲'}  今日 ${s.postCountToday}  ${s.logs[0]?.slice(0, 60) || ''}`);
  if (done) { published = done; break; }
  if (failed) { console.log('  ❌ 失败:', failed.error); break; }
}

const after = await readState();
console.log('\n=== 结果 ===');
console.log('条目:', JSON.stringify(after.items, null, 2));
console.log('今日已发:', after.postCountToday);
console.log('日志:', after.logs);

if (published?.href) {
  console.log(`\n✅ 发布成功: https://x.com${published.href}`);
}

// ---------------------------------------------------------------- 确认带图
console.log('\n>>> 到主页确认带图');
const tabId = await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);
await ev(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(17000);
const posts = JSON.parse(await ev(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 3).map(a => {
      const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
      const imgs = [...a.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
      return { href: link, text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').replace(/\\n/g, ' ').slice(0, 45), media: imgs.filter(s => s.includes('pbs.twimg.com/media')).length };
    })
  }).then(r => JSON.stringify(r[0]?.result))
`));
console.log('主页最近帖子:');
posts.forEach((p, i) => console.log(`  [${i + 1}] ${p.text}   图 ${p.media}`));

// ---------------------------------------------------------------- 收尾
console.log('\n>>> 收尾');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } });
await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } });

process.exit(0);
