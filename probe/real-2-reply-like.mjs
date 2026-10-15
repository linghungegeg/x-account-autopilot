// 真实验证 2：对自己刚发的测试帖真实评论 "good" + 真实点赞。
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

// ---------------------------------------------------------------- 找测试帖
console.log('>>> 到主页找测试帖的链接');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/${handle}' })`);
await sleep(9000);

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
let page = await cdp.attach(targets.find(t => t.type === 'page' && t.url.includes(`/${handle}`)));

const href = await page.eval(`(() => {
  const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
  for (const a of arts) {
    const text = a.querySelector('[data-testid="tweetText"]')?.innerText || '';
    if (!text.includes('自动化测试')) continue;
    return [...a.querySelectorAll('a[href*="/status/"]')]
      .map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || null;
  }
  return null;
})()`);
console.log('测试帖:', href);
if (!href) { console.log('❌ 找不到测试帖'); process.exit(1); }

// ---------------------------------------------------------------- 真实评论
console.log(`\n>>> 导航到测试帖详情页`);
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${href}' })`);
await sleep(9000);

console.log('\n>>> 发送 X_REPLY（真实提交）: "good"');
let started = Date.now();
const reply = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_REPLY',
    statusHref: ${JSON.stringify(href)},
    text: 'good',
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('结果:', reply);

// ---------------------------------------------------------------- 确认评论出现
console.log('\n>>> 刷新确认评论是否真的出现');
await sleep(3000);
const freshTargets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
page = await cdp.attach(freshTargets.find(t => t.type === 'page' && t.url.includes('/status/')));
await page.send('Page.reload');
await sleep(9000);

const found = await page.eval(`(() => {
  const texts = [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim());
  return { url: location.pathname, texts: texts.slice(0, 8), hasGood: texts.includes('good') };
})()`);
console.log('页面上的文本:', JSON.stringify(found, null, 2));

// ---------------------------------------------------------------- 真实点赞
console.log('\n>>> 发送 X_LIKE（真实提交）');
started = Date.now();
const like = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_LIKE',
    statusHref: ${JSON.stringify(href)},
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('结果:', like);

const likeState = await page.eval(`(() => {
  const a = document.querySelector('[data-testid="tweet"]');
  return {
    hasUnlike: !!a?.querySelector('[data-testid="unlike"]'),
    hasLike: !!a?.querySelector('[data-testid="like"]'),
    aria: a?.querySelector('[data-testid="unlike"]')?.getAttribute('aria-label') || a?.querySelector('[data-testid="like"]')?.getAttribute('aria-label')
  };
})()`);
console.log('点赞状态:', JSON.stringify(likeState));

console.log('\n=== 结论 ===');
const r = (() => { try { return JSON.parse(reply); } catch { return null; } })();
const l = (() => { try { return JSON.parse(like); } catch { return null; } })();
console.log(r?.ok ? '✅ 评论成功' : '❌ 评论失败: ' + (r?.error || reply));
console.log(found.hasGood ? '✅ 页面上确认看到了 "good"' : '⚠️ 页面上没找到 "good"（可能需要更久刷新）');
console.log(l?.ok ? '✅ 点赞成功' : '❌ 点赞失败: ' + (l?.error || like));

process.exit(0);
