// 列出用户最近的回复，供确认后再删。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg/with_replies' })`);
await sleep(16000);

const list = await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => {
      const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
      const author = (link.match(/^\\/([^/]+)\\//) || [])[1] || '?';
      const social = a.querySelector('[data-testid="socialContext"]')?.innerText || '';
      return {
        href: link,
        author,
        isMine: author === 'linghungg',
        social: social.slice(0, 30),
        text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').replace(/\\n/g, ' ').slice(0, 70)
      };
    })
  }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);

const items = JSON.parse(list);
console.log(`=== /with_replies 共 ${items.length} 条 ===`);
items.forEach((item, i) => {
  const kind = item.isMine ? '我发的帖' : '回复别人';
  console.log(`[${i + 1}] ${kind}  ${item.href}`);
  if (item.social) console.log(`     上下文：${item.social}`);
  console.log(`     ${item.text}`);
});

process.exit(0);
