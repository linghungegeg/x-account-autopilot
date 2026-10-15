// 真实验证：发帖带图（文字 "good" + 一张图），发布后确认图片真的在。
import { readFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const DATA_URL = 'data:image/png;base64,' + readFileSync('icons/icon128.png').toString('base64');

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);
console.log('工作标签页:', tabId, '| 图片:', Math.round(DATA_URL.length * 0.75), '字节');

const ev = (fn, timeoutMs = 120000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

// ---------------------------------------------------------------- 发帖带图
console.log('\n=== 导航到首页并发带图帖（文字 good）===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
await sleep(12000);

const started = Date.now();
const result = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_POST',
    text: 'good',
    mediaDataUrl: ${JSON.stringify(DATA_URL)},
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs: 150000 });
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('X_POST:', result);

// ---------------------------------------------------------------- 确认
console.log('\n=== 到主页确认帖子带图 ===');
await sleep(4000);
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(15000);

const list = await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 4).map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 20),
    photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasImg: !!a.querySelector('[data-testid="tweetPhoto"] img')
  };
})`);
console.log(list);

const parsed = (() => { try { return JSON.parse(list); } catch { return []; } })();
const mine = parsed.find(t => t.text === 'good');
console.log('\n刚发的帖子:', JSON.stringify(mine, null, 2));

// ---------------------------------------------------------------- 打开帖子本身
if (mine?.href) {
  console.log('\n=== 打开帖子自己的页面 ===');
  await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${mine.href}' })`);
  await sleep(15000);
  console.log(await ev(`() => ({
    url: location.pathname,
    photos: document.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasImg: !!document.querySelector('[data-testid="tweetPhoto"] img'),
    imgSrc: (document.querySelector('[data-testid="tweetPhoto"] img')?.getAttribute('src') || '').slice(0, 60),
    texts: [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim().slice(0, 20))
  })`));
}

console.log('\n=== 结论 ===');
const r = (() => { try { return JSON.parse(result); } catch { return null; } })();
console.log(r?.ok ? '提交成功' : '提交失败: ' + (r?.error || result));
console.log(mine?.photos > 0 ? `✅ 发帖带图成功（photos=${mine.photos}）` : '❌ 帖子发出去了但没有图');

process.exit(0);
