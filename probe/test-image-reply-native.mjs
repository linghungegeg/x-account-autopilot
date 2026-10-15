// 用原生 DOM.setFileInputFiles 测带图回复，验证时给足时间（避免再次假阴性）。
import { resolve } from 'node:path';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const IMAGE_PATH = resolve('icons/icon128.png');
const TARGET = process.env.STATUS_HREF || '/linghungg/status/2102106859184533915';

const cdp = await connect({ port: PORT });
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
const page = await cdp.attach(xTarget);
await page.send('Page.enable');
await page.send('DOM.enable');
await page.send('Network.enable');

const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url;
    if (/upload\.x\.com|CreateTweet/i.test(url)) net.push({ kind: 'req', q: decodeURIComponent((url.split('?')[1] || '')).slice(0, 100) });
  }
});

console.log(`=== 1. 导航到 ${TARGET}，点 reply ===`);
await page.send('Page.navigate', { url: `https://x.com${TARGET}` });
await sleep(14000);

await page.eval(`(() => {
  document.querySelector('[data-testid="tweet"]')?.querySelector('[data-testid="reply"]')?.click();
  return true;
})()`);
await sleep(4000);

console.log('>>> 2. 输入 "good"（先输入才会渲染媒体工具栏）');
// 轮询等非离屏编辑器出现
let editorReady = false;
for (let i = 0; i < 10; i += 1) {
  editorReady = await page.eval(`(() => {
    const eds = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')];
    const visible = eds.filter(x => !x.closest('[data-testid="inline_reply_offscreen"]'));
    return JSON.stringify({ total: eds.length, nonOffscreen: visible.length, path: location.pathname });
  })()`);
  console.log(`  ${(i + 1) * 1.5}s  ${editorReady}`);
  const info = JSON.parse(editorReady);
  if (info.nonOffscreen > 0) break;
  await sleep(1500);
}

const typed = await page.eval(`(() => {
  const eds = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')];
  const e = eds.find(x => !x.closest('[data-testid="inline_reply_offscreen"]')) || eds[0];
  if (!e) return 'no-editor';
  e.focus();
  document.execCommand('insertText', false, 'good');
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'good' }));
  return 'typed';
})()`);
console.log('  输入结果:', typed);
await sleep(2500);

console.log('>>> 3. 原生方式挂图');
const doc = await page.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-testid="fileInput"]' });
console.log('fileInput nodeId:', nodeId);

net.length = 0;
await page.send('DOM.setFileInputFiles', { nodeId, files: [IMAGE_PATH] });

for (let i = 1; i <= 6; i += 1) {
  await sleep(2500);
  const s = await page.eval(`(() => {
    const atts = [...document.querySelectorAll('[data-testid="attachments"]')];
    const att = atts.find(a => !a.closest('[data-testid="inline_reply_offscreen"]')) || atts[0];
    const b = [...document.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')]
      .filter(x => x.getClientRects().length)
      .map(x => ({ tid: x.getAttribute('data-testid'), off: !!x.closest('[data-testid="inline_reply_offscreen"]'), dis: x.disabled || x.getAttribute('aria-disabled') }));
    return { att: atts.length, imgs: att ? att.querySelectorAll('img').length : 0, buttons: b };
  })()`);
  console.log(`  ${i * 2.5}s  附件=${s.att} 图=${s.imgs} 按钮=${JSON.stringify(s.buttons)}`);
}

console.log('\n媒体请求:', net.filter(n => n.kind === 'req').map(n => n.q).join(' | ') || '（无）');

console.log('\n>>> 4. 提交（点非离屏的那个按钮）');
const clicked = await page.eval(`(() => {
  const b = [...document.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')]
    .filter(x => x.getClientRects().length && !x.closest('[data-testid="inline_reply_offscreen"]'))[0];
  if (!b) return 'no-visible-button';
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') return 'disabled';
  b.click();
  return 'clicked:' + b.getAttribute('data-testid');
})()`);
console.log('点击:', clicked);
await sleep(10000);

// ---------------------------------------------------------------- 5. 耐心验证
console.log('\n=== 5. 验证（每 10 秒查一次，最多 5 次）===');
await page.send('Page.navigate', { url: `https://x.com${TARGET}` });
await sleep(15000);

for (let i = 1; i <= 5; i += 1) {
  const s = await page.eval(`(() => {
    const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
    return {
      tweets: arts.length,
      replyAria: arts[0]?.querySelector('[data-testid="reply"]')?.getAttribute('aria-label'),
      photos: document.querySelectorAll('[data-testid="tweetPhoto"]').length,
      entries: arts.map(a => ({
        text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 15),
        photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length
      }))
    };
  })()`);
  console.log(`  第 ${i} 次 (${i * 10}s): ${JSON.stringify(s)}`);
  const good = s.entries?.find(e => e.text === 'good');
  if (good && good.photos > 0) { console.log('\n✅ 带图回复确实带图！'); break; }
  if (i < 5) await sleep(10000);
}

process.exit(0);
