// 带图评论聚焦测试：回复用户已有推文，验证图片是否真的附上。
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

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);
console.log('标签页:', tabId);

const ev = (fn, args = '[]', timeoutMs = 120000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn}, args: ${args} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

const nav = async (url, ms) => {
  await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`);
  await sleep(ms);
};

// ---------------------------------------------------------------- 1. 找一个目标推文
console.log('\n=== 1. 到主页找一条自己的推文 ===');
await nav('https://x.com/linghungg', 15000);

const href = await ev(`() => {
  const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
  for (const a of arts) {
    const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h));
    if (!link) continue;
    if (!link.startsWith('/linghungg/')) continue;
    return { href: link, text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').slice(0, 40) };
  }
  return null;
}`);
console.log('目标:', href);
const target = (() => { try { return JSON.parse(href); } catch { return null; } })();
if (!target) { console.log('❌ 没找到自己的推文'); process.exit(1); }

// ---------------------------------------------------------------- 2. 带图回复
console.log(`\n=== 2. 带图回复 ${target.href} ===`);
await nav(`https://x.com${target.href}`, 14000);

const started = Date.now();
const reply = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_REPLY',
    statusHref: ${JSON.stringify(target.href)},
    text: '带图测试',
    mediaDataUrl: ${JSON.stringify(DATA_URL)},
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs: 150000 });
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('X_REPLY:', reply);

// ---------------------------------------------------------------- 3. 验证
console.log('\n=== 3. 验证（刷新 /with_replies）===');
await sleep(5000);
await nav('https://x.com/linghungg/with_replies', 16000);

const list = await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 25),
    photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasImg: !!a.querySelector('[data-testid="tweetPhoto"] img')
  };
})`);
console.log(list);

const parsed = (() => { try { return JSON.parse(list); } catch { return []; } })();
const mine = parsed.find(t => t.text.includes('带图测试'));
console.log('\n我那条回复:', JSON.stringify(mine, null, 2));

// ---------------------------------------------------------------- 4. 打开回复本身
if (mine?.href) {
  console.log('\n=== 4. 打开回复自己的永久链接 ===');
  await nav(`https://x.com${mine.href}`, 15000);
  console.log(await ev(`() => ({
    url: location.pathname,
    photos: document.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasImg: !!document.querySelector('[data-testid="tweetPhoto"] img'),
    texts: [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim().slice(0, 25))
  })`));
}

console.log('\n=== 结论 ===');
const r = (() => { try { return JSON.parse(reply); } catch { return null; } })();
console.log(r?.ok ? '提交成功' : '提交失败: ' + (r?.error || reply));
console.log(mine?.photos > 0 ? `✅ 图片确实附上了（photos=${mine.photos}）` : '❌ 图片没附上');

process.exit(0);
