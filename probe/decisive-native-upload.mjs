// 决定性测试：用 CDP 原生 DOM.setFileInputFiles 挂图（等同真人选文件），
// 看图片能不能发出去。如果这样也不行，那就是 X 在剥离媒体，不是代码问题。
import { resolve } from 'node:path';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const IMAGE_PATH = resolve('icons/icon128.png');

const cdp = await connect({ port: PORT });
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
const page = await cdp.attach(xTarget);

await page.send('Page.enable');
await page.send('DOM.enable');

const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url;
    if (/upload\.x\.com|CreateTweet/i.test(url)) {
      net.push({ kind: 'req', q: decodeURIComponent((url.split('?')[1] || '')).slice(0, 110) });
    }
  }
  if (msg.method === 'Network.responseReceived' && /CreateTweet/i.test(msg.params.response.url)) {
    net.push({ kind: 'CreateTweet', status: msg.params.response.status, id: msg.params.requestId });
  }
});
await page.send('Network.enable');

console.log('=== 导航到首页 ===');
await page.send('Page.navigate', { url: 'https://x.com/home' });
await sleep(12000);

// 输入文字
console.log('>>> 输入 "good"');
await page.eval(`(() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  e.focus();
  document.execCommand('insertText', false, 'good');
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'good' }));
  return true;
})()`);
await sleep(1500);

// 原生设置文件（等同真人）
console.log('>>> DOM.setFileInputFiles 挂图（原生方式）');
const doc = await page.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-testid="fileInput"]' });
console.log('fileInput nodeId:', nodeId);
if (!nodeId) { console.log('❌ 找不到 fileInput'); process.exit(1); }

net.length = 0;
await page.send('DOM.setFileInputFiles', { nodeId, files: [IMAGE_PATH] });

// 监控
for (let i = 1; i <= 8; i += 1) {
  await sleep(2000);
  const s = await page.eval(`(() => {
    const att = document.querySelector('[data-testid="attachments"]');
    const img = att?.querySelector('img');
    const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"]')].find(x => x.getClientRects().length);
    return {
      att: att ? 1 : 0,
      imgs: att ? att.querySelectorAll('img').length : 0,
      src: (img?.getAttribute('src') || '').slice(0, 40),
      btnDisabled: b ? (b.disabled || b.getAttribute('aria-disabled')) : null
    };
  })()`);
  console.log(`  ${i * 2}s  附件=${s.att} 图=${s.imgs} src=${s.src} 按钮禁用=${s.btnDisabled}`);
  if (s.att > 0 && !s.btnDisabled && i >= 3) break;
}

console.log('\n挂图期间的媒体请求:');
net.filter(n => n.kind === 'req').forEach(n => console.log('  ' + n.q));

// 提交
net.length = 0;
console.log('\n>>> 点提交');
await page.eval(`(() => {
  const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"]')].find(x => x.getClientRects().length);
  if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return 'not-clickable';
  b.click();
  return 'clicked';
})()`);
await sleep(9000);

console.log('提交后的 CreateTweet 请求:');
const tweet = net.find(n => n.kind === 'CreateTweet');
if (tweet) {
  const body = await page.send('Network.getResponseBody', { requestId: tweet.id }).catch(() => null);
  console.log('  状态:', tweet.status);
  console.log('  响应:', (body?.body || '').slice(0, 300));
} else {
  console.log('  （没抓到 CreateTweet）');
}

// 确认
console.log('\n=== 到主页确认 ===');
await page.send('Page.navigate', { url: 'https://x.com/linghungg' });
await sleep(15000);
console.log(await page.eval(`(() => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 3).map(a => ({
  text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 15),
  photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length
})))()`));

process.exit(0);
