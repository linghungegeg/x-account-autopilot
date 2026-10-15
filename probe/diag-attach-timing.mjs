// 监控：在回复框挂图后，附件到底什么时候"就绪"，提交按钮什么时候可用。
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

const ev = (fn, args = '[]', timeoutMs = 120000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn}, args: ${args} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

const nav = async (url, ms) => { await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`); await sleep(ms); };

// 到之前那条测试帖
const TARGET = '/linghungg/status/2102106859184533915';
console.log(`=== 导航到 ${TARGET} 并打开回复框 ===`);
await nav(`https://x.com${TARGET}`, 14000);

await ev(`() => {
  const a = document.querySelector('[data-testid="tweet"]');
  a?.querySelector('[data-testid="reply"]')?.click();
  return true;
}`);
await sleep(3500);

console.log('填文字（触发工具栏）');
await ev(`() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  e.focus();
  document.execCommand('insertText', false, '带图监控');
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '带图监控' }));
  return true;
}`);
await sleep(2000);

const SNAP = `() => {
  const att = document.querySelector('[data-testid="attachments"]');
  const img = att?.querySelector('img');
  const btn = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].find(x => x.getClientRects().length);
  const bar = document.querySelector('[data-testid="progressBar-bar"]');
  return {
    t: Date.now(),
    attachments: att ? 1 : 0,
    attImgs: att ? att.querySelectorAll('img').length : 0,
    imgSrc: (img?.getAttribute('src') || '').slice(0, 30),
    imgNatural: img ? (img.naturalWidth + 'x' + img.naturalHeight) : null,
    progress: bar ? 1 : 0,
    btnTid: btn?.getAttribute('data-testid') || null,
    btnDisabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled')) : null,
    attAria: att?.getAttribute('aria-label') || null
  };
}`;

console.log('\n=== 塞入图片，然后每 2 秒采样一次 ===');
await ev(`async (dataUrl) => {
  const input = document.querySelector('[data-testid="fileInput"]');
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], 'test.png', { type: blob.type });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
}`, `[${JSON.stringify(DATA_URL)}]`);

for (let i = 1; i <= 15; i += 1) {
  await sleep(2000);
  const s = JSON.parse(await ev(SNAP));
  console.log(`  ${String(i * 2).padStart(2)}s  附件=${s.attachments} 图=${s.attImgs}(${s.imgNatural}) src=${s.imgSrc} 进度=${s.progress} 按钮=${s.btnTid}/${s.btnDisabled}`);
}

console.log('\n=== 再等 10 秒后提交 ===');
await sleep(10000);
console.log('提交前:', await ev(SNAP));

const clicked = await ev(`() => {
  const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].find(x => x.getClientRects().length);
  if (!b) return 'no-button';
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') return 'disabled';
  b.click();
  return 'clicked';
}`);
console.log('点击:', clicked);
await sleep(8000);
console.log('提交后:', await ev(SNAP));

process.exit(0);
