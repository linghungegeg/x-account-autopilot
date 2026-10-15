// 正确抓网络：调扩展自己的 X_REPLY（dryRun），看媒体有没有真的上传。
import { readFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const DATA_URL = 'data:image/png;base64,' + readFileSync('icons/icon128.png').toString('base64');
const TARGET = '/linghungg/status/2102106859184533915';

console.log(`本地图片: ${Math.round(DATA_URL.length * 0.75)} 字节 image/png`);

const cdp = await connect({ port: PORT });
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
const page = await cdp.attach(xTarget);

const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url;
    if (/upload\.x\.com|CreateTweet/i.test(url)) {
      net.push({ kind: 'req', method: msg.params.request.method, q: decodeURIComponent((url.split('?')[1] || '')).slice(0, 120) });
    }
  }
  if (msg.method === 'Network.responseReceived') {
    const url = msg.params.response.url;
    if (/upload\.x\.com|CreateTweet/i.test(url)) net.push({ kind: 'res', status: msg.params.response.status });
  }
});
await page.send('Network.enable');
await page.send('Page.enable');

// 用扩展页面发 X_REPLY
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

console.log(`\n>>> 导航到 ${TARGET}`);
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com${TARGET}' })`);
await sleep(14000);

net.length = 0;
console.log('\n>>> 调扩展的 X_REPLY（dryRun=true，挂图但不提交）');
const started = Date.now();
const result = await ext.eval(`
  chrome.tabs.sendMessage(${tabId}, {
    type: 'X_REPLY',
    statusHref: ${JSON.stringify(TARGET)},
    text: '网络抓取（不提交）',
    mediaDataUrl: ${JSON.stringify(DATA_URL)},
    dryRun: true,
    humanize: { humanize: false }
  }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs: 150000 });
console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('X_REPLY:', result);

console.log('\n=== 期间捕获到的媒体/发帖请求 ===');
if (net.length) net.forEach(n => console.log(`  [${n.kind}] ${n.status ?? n.method}  ${n.q || ''}`));
else console.log('  （没有）');

// 清理编辑器
await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (e) { e.focus(); const s = window.getSelection(); const r = document.createRange(); r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r); document.execCommand('delete', false); }
      return true;
    }
  })
`);

console.log('\n=== 结论 ===');
const init = net.find(n => n.q?.includes('command=INIT'));
if (init) {
  console.log('✅ 扩展确实触发了媒体上传');
  console.log('   ' + init.q);
} else {
  console.log('❌ 扩展没有触发媒体上传');
}

process.exit(0);
