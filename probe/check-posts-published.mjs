// 确认那几条"提交失败"的帖子到底发出去没有。
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

await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(16000);

const posts = await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 6).map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  const imgs = [...a.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').replace(/\\n/g, ' ').slice(0, 60),
    media: imgs.filter(s => s.includes('pbs.twimg.com/media')).length
  };
})`);

console.log('=== 主页最近帖子 ===');
JSON.parse(posts).forEach((p, i) => console.log(`[${i + 1}] ${p.href}\n     ${p.text}   (图 ${p.media})`));

process.exit(0);
