// 真实验证 1：用扩展自己的路径发一条帖（dryRun=false）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const TEXT = process.env.POST_TEXT || '（自动化测试）这是一条功能验证帖，稍后会删除。';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

// 关掉演练模式
const off = await ext.eval(`
  chrome.runtime.sendMessage({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: false, enabled: false } })
    .then(r => JSON.stringify({ ok: r.ok, dryRun: r.state?.behavior?.dryRun, enabled: r.state?.behavior?.enabled }))
`);
console.log('设置:', off);

// 找一个 x.com 标签页当工作页
const tabId = await ext.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(tabs => tabs[0]?.id ?? null)
`);
console.log('工作标签页:', tabId);

console.log('\n>>> 导航到 x.com/home');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
await sleep(8000);

// 等编辑器就绪
const ready = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, { type: 'X_PING' })
    .then(r => JSON.stringify({ ok: r.ok, url: r.url, challenge: r.challenge }))
    .catch(e => 'ERR: ' + e.message)
`);
console.log('页面:', ready);

// ---------------------------------------------------------------- 真实发帖
console.log(`\n>>> 发送 X_POST（真实提交）: "${TEXT}"`);
const started = Date.now();
const result = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_POST',
    text: ${JSON.stringify(TEXT)},
    mediaDataUrl: '',
    dryRun: false,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`);
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('结果:', result);

// ---------------------------------------------------------------- 找新帖 URL
console.log('\n>>> 到自己的主页找最新一条帖子');
const handle = await ext.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(async tabs => {
    const r = await chrome.tabs.sendMessage(tabs[0].id, { type: 'X_PING' });
    return r.account?.handle || '';
  })
`);
console.log('账号:', handle);

await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/${handle}' })`);
await sleep(9000);

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
const xPage = await cdp.attach(xTarget);

const newest = await xPage.eval(`(() => {
  const a = document.querySelector('[data-testid="tweet"]');
  if (!a) return null;
  const link = [...a.querySelectorAll('a[href*="/status/"]')]
    .map(x => x.getAttribute('href'))
    .find(h => /\\/status\\/\\d+$/.test(h));
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').slice(0, 60),
    hasUnlike: !!a.querySelector('[data-testid="unlike"]'),
    hasLike: !!a.querySelector('[data-testid="like"]')
  };
})()`);
console.log('最新帖子:', JSON.stringify(newest, null, 2));

console.log('\n=== 结论 ===');
const parsed = (() => { try { return JSON.parse(result); } catch { return null; } })();
console.log(parsed?.ok ? '✅ 发帖成功（真实提交）' : '❌ 发帖失败: ' + (parsed?.error || result));
if (newest?.href) console.log('帖子地址: https://x.com' + newest.href);

process.exit(0);
