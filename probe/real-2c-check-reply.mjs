// 查证 "good" 评论到底发出去了没有。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const HREF = '/linghungg/status/2102101871532146707';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2000);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

const run = (url, waitMs) => ext.eval(`
  chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })
    .then(() => new Promise(r => setTimeout(r, ${waitMs})))
    .then(() => chrome.scripting.executeScript({
      target: { tabId: ${tabId} },
      func: () => {
        const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
        const main = arts[0];
        const replyBtn = main?.querySelector('[data-testid="reply"]');
        return {
          url: location.pathname,
          tweetCount: arts.length,
          replyButtonAria: replyBtn?.getAttribute('aria-label') || null,
          texts: [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim().slice(0, 60))
        };
      }
    }))
    .then(r => JSON.stringify(r[0]?.result))
    .catch(e => 'ERR: ' + e.message)
`);

console.log('=== A. 帖子详情页 ===');
console.log(await run(`https://x.com${HREF}`, 12000));

console.log('\n=== B. 带回复的主页 (/with_replies) ===');
console.log(await run('https://x.com/linghungg/with_replies', 13000));

console.log('\n=== C. 从搜索找 "good" ===');
const search = await ext.eval(`
  chrome.tabs.update(${tabId}, { url: 'https://x.com/search?q=from%3Alinghungg%20good&src=typed_query&f=live' })
    .then(() => new Promise(r => setTimeout(r, 13000)))
    .then(() => chrome.scripting.executeScript({
      target: { tabId: ${tabId} },
      func: () => ({
        url: location.pathname + location.search,
        tweets: document.querySelectorAll('[data-testid="tweet"]').length,
        texts: [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim().slice(0, 60)),
        empty: (document.body.innerText.match(/没有结果|No results|Try searching/i) || [])[0] || null
      })
    }))
    .then(r => JSON.stringify(r[0]?.result))
    .catch(e => 'ERR: ' + e.message)
`);
console.log(search);

process.exit(0);
