// 重测带图评论：用本地图片隔离变量，并在删除前确认图片是否真的附上。
import { readFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const PNG = readFileSync('icons/icon128.png').toString('base64');
const DATA_URL = `data:image/png;base64,${PNG}`;

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

const run = (fn, args = '') => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);
const goto = async (url, ms) => { await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`); await sleep(ms); };

// ---------------------------------------------------------------- 1. 发测试帖
console.log('=== 1. 发一条测试帖 ===');
await goto('https://x.com/home', 10000);
const post = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_POST', text: '（带图评论测试帖）', mediaDataUrl: '', dryRun: false, humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log('发帖:', post);

await goto('https://x.com/linghungg', 12000);
const href = await run(`() => {
  const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
  for (const a of arts) {
    if (!(a.querySelector('[data-testid="tweetText"]')?.innerText || '').includes('带图评论测试帖')) continue;
    return [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || null;
  }
  return null;
}`);
console.log('测试帖 href:', href);
if (!href) { console.log('❌ 找不到测试帖'); process.exit(1); }

// ---------------------------------------------------------------- 2. 带图回复
console.log('\n=== 2. 带本地图片回复（真实提交）===');
await goto(`https://x.com${href}`, 12000);

const started = Date.now();
const reply = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_REPLY',
    statusHref: ${JSON.stringify(href)},
    text: '带图测试',
    mediaDataUrl: ${JSON.stringify(DATA_URL)},
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs: 120000 });
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('X_REPLY:', reply);

// ---------------------------------------------------------------- 3. 确认图片
console.log('\n=== 3. 确认回复是否真的带图 ===');
await sleep(4000);
await goto('https://x.com/linghungg/with_replies', 14000);

const list = await run(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 30),
    photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasImg: !!a.querySelector('[data-testid="tweetPhoto"] img'),
    imgSrc: (a.querySelector('[data-testid="tweetPhoto"] img')?.getAttribute('src') || '').slice(0, 60)
  };
})`);
console.log(list);

const parsed = (() => { try { return JSON.parse(list); } catch { return []; } })();
const target = parsed.find(t => t.text.includes('带图测试'));
console.log('\n带图回复条目:', JSON.stringify(target, null, 2));

// ---------------------------------------------------------------- 4. 打开回复本身确认
if (target?.href) {
  console.log(`\n=== 4. 打开回复自己的页面确认 ===`);
  await goto(`https://x.com${target.href}`, 13000);
  const detail = await run(`() => ({
    url: location.pathname,
    photos: document.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasImg: !!document.querySelector('[data-testid="tweetPhoto"] img'),
    texts: [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim().slice(0, 30))
  })`);
  console.log(detail);
}

console.log('\n=== 结论 ===');
console.log(target?.photos > 0 ? `✅ 带图评论确认带图（photos=${target.photos}）` : '❌ 评论发出去了但没有图');

process.exit(0);
