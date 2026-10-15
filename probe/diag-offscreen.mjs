// 决定性检查：附件挂在哪个编辑器上？是不是离屏的那个？
import { readFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const DATA_URL = 'data:image/png;base64,' + readFileSync('icons/icon128.png').toString('base64');
const TARGET = '/linghungg/status/2102106859184533915';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, timeoutMs = 120000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

const nav = async (url, ms) => { await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`); await sleep(ms); };

await nav(`https://x.com${TARGET}`, 14000);

console.log('=== 点 reply 之前：页面上有几个编辑器 / 几个离屏容器 ===');
console.log(await ev(`() => ({
  editors: document.querySelectorAll('[data-testid="tweetTextarea_0"]').length,
  offscreen: document.querySelectorAll('[data-testid="inline_reply_offscreen"]').length,
  fileInputs: document.querySelectorAll('[data-testid="fileInput"]').length,
  submitButtons: [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].map(b => ({
    tid: b.getAttribute('data-testid'), visible: b.getClientRects().length > 0
  }))
})`));

await ev(`() => { document.querySelector('[data-testid="tweet"]')?.querySelector('[data-testid="reply"]')?.click(); return true; }`);
await sleep(3500);

console.log('\n=== 点 reply 之后 ===');
console.log(await ev(`() => ({
  path: location.pathname,
  editors: document.querySelectorAll('[data-testid="tweetTextarea_0"]').length,
  offscreen: document.querySelectorAll('[data-testid="inline_reply_offscreen"]').length,
  fileInputs: document.querySelectorAll('[data-testid="fileInput"]').length,
  submitButtons: [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].map(b => ({
    tid: b.getAttribute('data-testid'), visible: b.getClientRects().length > 0,
    inOffscreen: !!b.closest('[data-testid="inline_reply_offscreen"]')
  }))
})`));

// 填字 + 挂图
await ev(`() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  e.focus();
  document.execCommand('insertText', false, '离屏检查');
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '离屏检查' }));
  return true;
}`);
await sleep(2000);

await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    args: [${JSON.stringify(DATA_URL)}],
    func: async (dataUrl) => {
      const input = document.querySelector('[data-testid="fileInput"]');
      const blob = await (await fetch(dataUrl)).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 't.png', { type: blob.type }));
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  })
`);
await sleep(6000);

console.log('\n=== 挂图之后：附件在哪 ===');
console.log(await ev(`() => {
  const atts = [...document.querySelectorAll('[data-testid="attachments"]')];
  return {
    attachmentNodes: atts.length,
    details: atts.map(a => ({
      inOffscreen: !!a.closest('[data-testid="inline_reply_offscreen"]'),
      // 它和哪个编辑器在同一个 composer 里
      sameComposerAsEditor: !!a.closest('div')?.parentElement?.querySelector('[data-testid="tweetTextarea_0"]'),
      composerAncestor: (() => {
        let el = a, names = [];
        for (let i = 0; i < 12 && el; i += 1) {
          const tid = el.getAttribute?.('data-testid');
          if (tid) names.push(tid);
          el = el.parentElement;
        }
        return names;
      })(),
      imgs: a.querySelectorAll('img').length
    }))
  };
}`));

// 清理
await ev(`() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (e) { e.focus(); const s = window.getSelection(); const r = document.createRange(); r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r); document.execCommand('delete', false); }
  return true;
}`);

process.exit(0);
