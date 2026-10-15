// 抓网络：带图回复时，X 到底有没有真的上传媒体？
import { readFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const DATA_URL = 'data:image/png;base64,' + readFileSync('icons/icon128.png').toString('base64');
const TARGET = '/linghungg/status/2102106859184533915';

const cdp = await connect({ port: PORT });

// 用 CDP 直连页面抓网络（扩展页面抓不到页面自己的请求）
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
const page = await cdp.attach(xTarget);

const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url;
    if (/upload\.x\.com|media\/upload|CreateTweet|CreateNoteTweet/i.test(url)) {
      net.push({ kind: 'req', url: url.split('?')[0], query: decodeURIComponent((url.split('?')[1] || '')).slice(0, 130), method: msg.params.request.method });
    }
  }
  if (msg.method === 'Network.responseReceived') {
    const url = msg.params.response.url;
    if (/upload\.x\.com|media\/upload|CreateTweet/i.test(url)) {
      net.push({ kind: 'res', status: msg.params.response.status, url: url.split('?')[0] });
    }
  }
});
await page.send('Network.enable');
await page.send('Page.enable');

console.log(`>>> 导航到 ${TARGET}`);
await page.send('Page.navigate', { url: `https://x.com${TARGET}` });
await sleep(13000);

// 点 reply
await page.eval(`(() => {
  const a = document.querySelector('[data-testid="tweet"]');
  a?.querySelector('[data-testid="reply"]')?.click();
  return true;
})()`);
await sleep(3500);

// 填字
await page.eval(`(() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  e.focus();
  document.execCommand('insertText', false, '网络抓取测试');
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '网络抓取测试' }));
  return true;
})()`);
await sleep(1500);

// 挂图
net.length = 0;
console.log('\n>>> 挂图（观察是否触发上传）');
await page.eval(`(async (dataUrl) => {
  const input = document.querySelector('[data-testid="fileInput"]');
  const blob = await (await fetch(dataUrl)).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 't.png', { type: blob.type }));
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`, { });

await sleep(8000);
console.log('挂图后 8 秒内的媒体请求:');
if (net.length) net.forEach(n => console.log(`  [${n.kind}] ${n.status ?? n.method} ${n.url} ${n.query || ''}`));
else console.log('  （没有任何媒体上传请求！）');

// 提交
net.length = 0;
console.log('\n>>> 点提交');
await page.eval(`(() => {
  const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].find(x => x.getClientRects().length);
  if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return 'not-clickable';
  b.click();
  return 'clicked';
})()`);
await sleep(10000);

console.log('提交后 10 秒内的请求:');
if (net.length) net.forEach(n => console.log(`  [${n.kind}] ${n.status ?? n.method} ${n.url} ${n.query || ''}`));
else console.log('  （没有任何 CreateTweet 请求！）');

process.exit(0);
