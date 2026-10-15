// 可靠判据：推文里有没有 pbs.twimg.com/media 的图片（不依赖 tweetPhoto 这个懒加载节点）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const HREF = process.env.STATUS_HREF || '/linghungg/status/2102112979747786929';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, timeoutMs = 120000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

const CHECK = `() => {
  const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
  return {
    path: location.pathname,
    scrollY: Math.round(window.scrollY),
    tweets: arts.map(a => {
      const imgs = [...a.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
      const mediaImgs = imgs.filter(s => s.includes('pbs.twimg.com/media') || s.includes('pbs.twimg.com/amplify'));
      return {
        text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 18),
        totalImgs: imgs.length,
        mediaImgs: mediaImgs.length,
        sample: mediaImgs[0]?.slice(0, 70) || null,
        photoNodes: a.querySelectorAll('[data-testid="tweetPhoto"]').length
      };
    })
  };
}`;

console.log(`=== 打开 ${HREF} 的永久链接 ===`);
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${HREF}' })`);
await sleep(18000);

console.log(await ev(CHECK));

console.log('\n=== 滚动一下再查（触发懒加载）===');
await ext.eval(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => { window.scrollBy(0, 300); window.scrollBy(0, -300); return true; } })`);
await sleep(4000);
console.log(await ev(CHECK));

console.log('\n=== 再看主页 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(16000);
console.log(await ev(CHECK));

process.exit(0);
