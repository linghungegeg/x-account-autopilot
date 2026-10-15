// 带图回复：重置状态 + 原生挂图 + 长时间多界面交叉验证。
import { resolve } from 'node:path';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const IMAGE_PATH = resolve('icons/icon128.png');
const TARGET = '/linghungg/status/2102106859184533915';

const cdp = await connect({ port: PORT });
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
const page = await cdp.attach(xTarget);
await page.send('Page.enable');
await page.send('DOM.enable');
await page.send('Network.enable');

const snap = () => page.eval(`(() => ({
  path: location.pathname,
  editors: document.querySelectorAll('[data-testid="tweetTextarea_0"]').length,
  fileInputs: document.querySelectorAll('[data-testid="fileInput"]').length,
  attachments: document.querySelectorAll('[data-testid="attachments"]').length
}))()`);

// ---------------------------------------------------------------- 0. 重置
console.log('=== 0. 重置页面状态 ===');
await page.send('Page.navigate', { url: 'https://x.com/home' });
await sleep(12000);
console.log('home:', JSON.stringify(await snap()));

// ---------------------------------------------------------------- 1. 到帖子页点 reply
console.log(`\n=== 1. 到 ${TARGET} 点 reply ===`);
await page.send('Page.navigate', { url: `https://x.com${TARGET}` });
await sleep(15000);
console.log('导航后:', JSON.stringify(await snap()));

await page.eval(`(() => { document.querySelector('[data-testid="tweet"]')?.querySelector('[data-testid="reply"]')?.click(); return true; })()`);

let ok = false;
for (let i = 0; i < 12; i += 1) {
  await sleep(1500);
  const s = await snap();
  console.log(`  ${(i + 1) * 1.5}s ${JSON.stringify(s)}`);
  if (s.editors > 0) { ok = true; break; }
}
if (!ok) { console.log('❌ 回复框一直没出来'); process.exit(1); }

// ---------------------------------------------------------------- 2. 输入
console.log('\n=== 2. 输入 good ===');
console.log(await page.eval(`(() => {
  const eds = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')];
  const e = eds.find(x => !x.closest('[data-testid="inline_reply_offscreen"]')) || eds[0];
  if (!e) return 'no-editor';
  e.focus();
  document.execCommand('insertText', false, 'good');
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'good' }));
  return 'typed';
})()`));
await sleep(3000);
console.log('输入后:', JSON.stringify(await snap()));

// ---------------------------------------------------------------- 3. 原生挂图
console.log('\n=== 3. 原生挂图 ===');
const doc = await page.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-testid="fileInput"]' });
console.log('nodeId:', nodeId);
if (!nodeId) { console.log('❌ 没有 fileInput'); process.exit(1); }

const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent' && /upload\.x\.com/.test(msg.params.request.url)) {
    net.push(decodeURIComponent((msg.params.request.url.split('?')[1] || '')).slice(0, 80));
  }
});
await page.send('DOM.setFileInputFiles', { nodeId, files: [IMAGE_PATH] });
await sleep(6000);
console.log('附件状态:', JSON.stringify(await snap()));
console.log('媒体请求:', net.join(' | ') || '（无）');

// ---------------------------------------------------------------- 4. 提交
console.log('\n=== 4. 提交（非离屏按钮）===');
console.log(await page.eval(`(() => {
  const b = [...document.querySelectorAll('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]')]
    .filter(x => x.getClientRects().length && !x.closest('[data-testid="inline_reply_offscreen"]'))[0];
  if (!b) return 'no-visible-button';
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') return 'disabled';
  b.click();
  return 'clicked:' + b.getAttribute('data-testid');
})()`));
await sleep(12000);

// ---------------------------------------------------------------- 5. 耐心交叉验证
console.log('\n=== 5. 交叉验证（给足时间）===');
const check = async (label, url) => {
  await page.send('Page.navigate', { url });
  await sleep(18000);
  const out = await page.eval(`(() => {
    const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
    return {
      path: location.pathname,
      photos: document.querySelectorAll('[data-testid="tweetPhoto"]').length,
      entries: arts.map(a => ({
        text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 15),
        photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length
      }))
    };
  })()`);
  console.log(`${label}: ${JSON.stringify(out)}`);
  return out;
};

const a = await check('时间线 /with_replies', 'https://x.com/linghungg/with_replies');
await sleep(8000);
const b = await check('帖子详情页', `https://x.com${TARGET}`);
await sleep(8000);
const c = await check('再查一次时间线', 'https://x.com/linghungg/with_replies');

const found = [a, b, c].flatMap(x => x.entries || []).find(e => e.text === 'good' && e.photos > 0);
console.log('\n=== 结论 ===');
console.log(found ? '✅ 带图回复确实带图！' : '❌ 三个界面都没看到带图的 good 回复');

process.exit(0);
