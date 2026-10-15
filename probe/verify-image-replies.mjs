// 核实：之前判定"没图"的那几条带图回复，到底有没有图？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, timeoutMs = 120000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

// 之前判定"没图"的三条回复
const REPLIES = [
  { href: '/linghungg/status/2102109464774295621', text: '带图测试' },
  { href: '/linghungg/status/2102107262567456925', text: '带图测试' },
  { href: '/linghungg/status/2102107791016300749', text: '带图监控' }
];

console.log('=== 逐条打开回复的永久链接核实 ===\n');
for (const r of REPLIES) {
  await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${r.href}' })`);
  await sleep(14000);
  const info = await ev(`() => ({
    url: location.pathname,
    photos: document.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasImg: !!document.querySelector('[data-testid="tweetPhoto"] img'),
    imgSrc: (document.querySelector('[data-testid="tweetPhoto"] img')?.getAttribute('src') || '').slice(0, 70),
    texts: [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim().slice(0, 20))
  })`);
  console.log(`${r.text}  ${r.href}`);
  console.log(`  ${info}\n`);
}

// 再看 /with_replies 全貌
console.log('=== /with_replies 全貌 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg/with_replies' })`);
await sleep(16000);
console.log(await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 10).map(a => ({
  text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 18),
  photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length
}))`));

process.exit(0);
