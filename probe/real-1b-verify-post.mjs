// 确认帖子真的发出去了：到主页列前几条，看作者和内容。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2000);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);
const handle = await ext.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(async t => {
    const r = await chrome.tabs.sendMessage(t[0].id, { type: 'X_PING' });
    return r.account?.handle || '';
  })
`);
console.log('账号:', handle, '| 标签页:', tabId);

console.log(`>>> 导航到 https://x.com/${handle}`);
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/${handle}' })`);

// 多等一会儿，并轮询
for (let i = 0; i < 10; i += 1) {
  await sleep(2500);
  const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
  const t = targets.find(x => x.type === 'page' && x.url.includes(`/${handle}`));
  if (!t) continue;
  const page = await cdp.attach(t);
  const info = await page.eval(`(() => {
    const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
    return {
      url: location.pathname,
      count: arts.length,
      items: arts.slice(0, 5).map(a => {
        const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
        const author = (link.match(/^\\/([^/]+)\\//) || [])[1] || '?';
        return author + ' :: ' + (a.querySelector('[data-testid="tweetText"]')?.innerText || '').slice(0, 50);
      })
    };
  })()`);
  console.log(`  ${(i + 1) * 2.5}s  路径=${info.url} 推文=${info.count}`);
  if (info.count > 0) {
    info.items.forEach(x => console.log('     ' + x));
    if (info.items.some(x => x.startsWith(handle + ' ::'))) { console.log('  ✅ 看到自己的帖子了'); break; }
  }
}

process.exit(0);
