// 确认 "good" 评论真的出现了 + 真实点赞。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const HREF = process.env.STATUS_HREF || '/linghungg/status/2102101871532146707';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2000);

const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);
console.log('标签页:', tabId, '| 目标:', HREF);

// 重新导航到帖子详情页
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${HREF}' })`);
await sleep(11000);

// 通过 chrome.tabs.sendMessage 直接读 DOM（不依赖 CDP target 列表）
const dom = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, { type: 'X_GET_STATE' })
    .then(r => JSON.stringify({ url: r.url, tweets: r.counts?.tweets, editor: r.editor }))
    .catch(e => 'ERR: ' + e.message)
`);
console.log('页面状态:', dom);

// 用 chrome.scripting 在页面里读文本（扩展有 scripting 权限）
const texts = await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => [...document.querySelectorAll('[data-testid="tweetText"]')].map(e => (e.innerText || '').trim()).slice(0, 10)
  }).then(r => JSON.stringify(r[0]?.result ?? [])).catch(e => 'ERR: ' + e.message)
`);
console.log('\n页面上的文本:');
try {
  JSON.parse(texts).forEach((t, i) => console.log(`  ${i + 1}. ${t.slice(0, 70)}`));
} catch { console.log('  ' + texts); }

const hasGood = texts.includes('"good"');
console.log(hasGood ? '\n✅ 页面上确认看到了 "good" —— 评论真的发出去了' : '\n⚠️ 没找到 "good"');

// ---------------------------------------------------------------- 真实点赞
console.log('\n>>> 发送 X_LIKE（真实提交）');
const started = Date.now();
const like = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_LIKE',
    statusHref: ${JSON.stringify(HREF)},
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('结果:', like);

await sleep(2500);
const likeState = await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const a = document.querySelector('[data-testid="tweet"]');
      const un = a?.querySelector('[data-testid="unlike"]');
      const li = a?.querySelector('[data-testid="like"]');
      return { hasUnlike: !!un, hasLike: !!li, aria: (un || li)?.getAttribute('aria-label') || null };
    }
  }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);
console.log('点赞状态:', likeState);

const l = (() => { try { return JSON.parse(like); } catch { return null; } })();
console.log('\n=== 结论 ===');
console.log(l?.ok ? '✅ 点赞成功（真实提交）' : '❌ 点赞失败: ' + (l?.error || like));

process.exit(0);
