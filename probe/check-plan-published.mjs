// 确认计划帖有没有真的发出去（带图）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, timeoutMs = 60000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

console.log('=== 计划条目最终状态 ===');
console.log(await ext.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    dryRun: r.state.behavior.dryRun,
    current: r.state.current,
    postCountToday: r.state.postCountToday,
    lastPostAt: r.state.lastPostAt ? new Date(r.state.lastPostAt).toLocaleTimeString('zh-CN', {hour12:false}) : 0,
    items: r.state.postPlan.items.map(i => ({ status: i.status, weight: i.weight, href: i.statusHref, error: i.error, text: i.text.slice(0, 50) })),
    logs: r.state.logs.slice(0, 10).map(l => l.tag + ' | ' + l.level + ' | ' + l.message.slice(0, 80))
  }, null, 2))
`));

// 到主页找带图的新帖
console.log('\n=== 主页最近帖子（含图判断）===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(16000);

const posts = await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 5).map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  const imgs = [...a.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').replace(/\\n/g, ' ').slice(0, 55),
    mediaImgs: imgs.filter(s => s.includes('pbs.twimg.com/media') || s.includes('pbs.twimg.com/amplify')).length,
    sample: imgs.find(s => s.includes('pbs.twimg.com/media'))?.slice(0, 60) || null
  };
})`);
JSON.parse(posts).forEach((p, i) => {
  console.log(`\n[${i + 1}] ${p.href}`);
  console.log(`    ${p.text}`);
  console.log(`    媒体图 ${p.mediaImgs} 张 ${p.sample ? '→ ' + p.sample : ''}`);
});

process.exit(0);
