// 带图发帖埋点观测：实时抓内容脚本的 console，看它卡在哪一步。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });

// 先清掉多余标签页
const all = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
let keptX = false;
for (const p of all.filter(t => t.type === 'page')) {
  const isX = p.url.includes('x.com');
  if (isX && !keptX) { keptX = true; continue; }
  if (p.url.startsWith('chrome-extension://') || p.url.startsWith('chrome://')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${p.id}`, { method: 'PUT' }).catch(() => {});
  }
}
await sleep(2500);

// 连到 x.com 页面抓 console
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTab = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
if (!xTab) { console.log('没有 x.com 标签页'); process.exit(1); }
const xPage = await cdp.attach(xTab);

const traces = [];
xPage.on(msg => {
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (text.includes('[x-probe]')) {
      traces.push(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${text}`);
      console.log('  ' + traces[traces.length - 1]);
    }
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    console.log('  EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || '').slice(0, 200));
  }
});
await xPage.send('Runtime.enable');

// 用扩展页面触发生图 + 带图发帖
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);
const ev = (expr, timeoutMs = 300000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 300000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);
const tabId = await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

console.log('=== 准备：生一张图 ===');
const t0 = Date.now();
const img = await ev(`
  chrome.runtime.sendMessage({ type: 'AI_IMAGE', prompt: 'a small blue bird on a wire, soft daylight' })
    .then(r => { window.__img = r.dataUrl || ''; return JSON.stringify({ ok: r.ok, kb: Math.round((r.dataUrl||'').length * 0.75 / 1024) }); })
    .catch(e => 'ERR: ' + e.message)
`, 240000);
console.log(`生图 ${Math.round((Date.now() - t0) / 1000)}s  ${img}`);

console.log('\n=== 导航到首页 ===');
await ev(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
await sleep(13000);
console.log(await ev(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => JSON.stringify({
    path: location.pathname,
    editors: document.querySelectorAll('[data-testid="tweetTextarea_0"]').length,
    fileInputs: document.querySelectorAll('[data-testid="fileInput"]').length
  }) }).then(r => r[0]?.result)
`));

console.log('\n=== 调 X_POST（带图，dryRun）—— 实时看埋点 ===');
const t1 = Date.now();
const result = await ev(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_POST',
    text: 'image trace probe',
    mediaDataUrl: window.__img,
    dryRun: true,
    humanize: { humanize: true, humanizeScrollMin: 2, humanizeScrollMax: 6, humanizePauseMinSec: 2, humanizePauseMaxSec: 8 }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`, 300000);
console.log(`\n总耗时 ${Math.round((Date.now() - t1) / 1000)}s`);
console.log('结果:', result);

console.log('\n=== 埋点时间线 ===');
traces.forEach(t => console.log('  ' + t));

// 清理
await ev(`chrome.tabs.sendMessage(${tabId}, { type: 'X_CLEAR_DRAFT' }).catch(() => {})`);
process.exit(0);
