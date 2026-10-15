// 清理标签页 + 提高发帖上限，重测定时时间点 + 带图。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const LEAD_MINUTES = Number(process.env.LEAD_MINUTES) || 2;

const cdp = await connect({ port: PORT });

// 先关掉多余的页面（只留一个 x.com 和一个扩展页）
const all = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const pages = all.filter(t => t.type === 'page');
let keptX = false;
let keptExt = false;
for (const p of pages) {
  const isX = p.url.includes('x.com');
  const isExt = p.url.startsWith('chrome-extension://') && p.url.includes(EXT_ID);
  if (isX && !keptX) { keptX = true; continue; }
  if (isExt && !keptExt) { keptExt = true; continue; }
  await fetch(`http://127.0.0.1:${PORT}/json/close/${p.id}`, { method: 'PUT' }).catch(() => {});
}
await sleep(3000);
const left = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('保留的页面:', left.filter(t => t.type === 'page').map(t => t.url.slice(0, 60)));

const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3500);

const ev = (expr, timeoutMs = 200000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 200000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);
const readState = async () => JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    current: r.state.current,
    postCountToday: r.state.postCountToday,
    postHour: r.state.stats.byAction.post.hour,
    items: r.state.postPlan.items.map(i => ({ status: i.status, href: i.statusHref, error: i.error, text: i.text.slice(0, 40) })),
    logs: r.state.logs.slice(0, 3).map(l => l.tag + ' | ' + l.message.slice(0, 65))
  }))
`));

console.log('\n>>> 准备');
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_COOLDOWN' });
await call({ type: 'CLEAR_SEEN' });
await call({ type: 'SAVE_KEYWORDS', keywords: [] });
// 提高发帖小时上限，否则被护栏挡住（默认 1/时）
await call({ type: 'SAVE_BEHAVIOR', behavior: {
  perAction: { browse: { maxPerHour: 15, maxPerDay: 80 }, like: { maxPerHour: 10, maxPerDay: 60 }, reply: { maxPerHour: 4, maxPerDay: 20 }, follow: { maxPerHour: 6, maxPerDay: 30 }, post: { maxPerHour: 5, maxPerDay: 10 } },
  maxPerHour: 30, maxPerDay: 200
} });

// 删掉所有非 pending 条目（failed / published 都不会重试，会干扰测试判定）
const stale = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(r.state.postPlan.items.filter(i => i.status !== 'pending').map(i => i.id)))
`));
for (const id of stale) await call({ type: 'DELETE_POST_ITEM', id });
console.log(`清掉 ${stale.length} 条非待发条目`);

// 只留一条待发；没有就现生成一条
let ids = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(r.state.postPlan.items.filter(i => i.status === 'pending').map(i => i.id)))
`));
while (ids.length > 1) await call({ type: 'DELETE_POST_ITEM', id: ids.pop() });
if (!ids.length) {
  console.log('没有待发条目，现生成一条');
  await call({ type: 'GENERATE_POSTS', mode: 'translate', sources: ['今天把拖了很久的缓存层重写了，代码少了三分之一，跑得还更快。'], language: 'en' });
  ids = JSON.parse(await ev(`
    chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(r.state.postPlan.items.filter(i => i.status === 'pending').map(i => i.id)))
  `));
}
if (!ids.length) { console.log('❌ 还是没条目'); process.exit(1); }

const target = new Date(Date.now() + LEAD_MINUTES * 60 * 1000);
const hhmm = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
console.log(`现在 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}，时间点=${hhmm}，配图=总是，发帖上限已提到 5/时`);

console.log(await call({
  type: 'SAVE_POST_PLAN',
  plan: { enabled: true, scheduledTimes: [hhmm], windowStart: 0, windowEnd: 0, dailyLimit: 5, language: 'en', withImage: 'always', imageChance: 1, maxWeight: 280 }
}));

await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } });
await call({ type: 'SET_ENABLED', enabled: true });

console.log('\n=== 等待 ===');
let published = null;
const deadline = Date.now() + (LEAD_MINUTES + 6) * 60 * 1000;
while (Date.now() < deadline) {
  await sleep(15000);
  const s = await readState();
  console.log(`  ${new Date().toLocaleTimeString('zh-CN',{hour12:false})}  ${s.current ? `${s.current.stage} ${s.current.progress}%` : '空闲'}  今日 ${s.postCountToday}  ${s.logs[0]?.slice(0, 60) || ''}`);
  const done = s.items.find(i => i.status === 'published');
  const failed = s.items.find(i => i.status === 'failed');
  if (done) { published = done; break; }
  if (failed) { console.log('  ❌ 失败:', failed.error); break; }
}

const after = await readState();
console.log('\n=== 结果 ===');
console.log(JSON.stringify(after, null, 2));
if (published?.href) console.log(`\n✅ 定时发布成功: https://x.com${published.href}`);

// 确认带图
const tabId = await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);
await ev(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(17000);
const posts = JSON.parse(await ev(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 3).map(a => {
      const imgs = [...a.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
      return { text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').replace(/\\n/g,' ').slice(0, 45), media: imgs.filter(s => s.includes('pbs.twimg.com/media')).length };
    })
  }).then(r => JSON.stringify(r[0]?.result))
`));
console.log('\n主页最近帖子:');
posts.forEach((p, i) => console.log(`  [${i+1}] ${p.text}   图 ${p.media}`));

console.log('\n>>> 收尾');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } });
await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } });

process.exit(0);
