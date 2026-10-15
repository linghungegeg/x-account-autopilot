// 内联回复框是不是要聚焦后才出现工具栏和 fileInput？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

const SNAP = `() => ({
  path: location.pathname,
  fileInputs: document.querySelectorAll('input[type="file"]').length,
  toolbar: !!document.querySelector('[data-testid="toolBar"]'),
  mediaAria: [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).filter(a => /photo|video|媒体|图片|视频|GIF/i.test(a)),
  editorFocused: document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName,
  containerStyle: document.querySelector('[data-testid="tweetTextarea_0RichTextInputContainer"]')?.getAttribute('style')
})`;

const snap = async () => {
  const out = await ext.eval(`
    chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${SNAP} })
      .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
  `);
  try { return JSON.parse(out); } catch { return out; }
};

console.log('=== 当前状态 ===');
console.log(JSON.stringify(await snap(), null, 2));

console.log('\n>>> 点击编辑器聚焦');
await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!e) return 'no-editor';
      e.focus();
      e.click();
      return 'clicked';
    }
  })
`);
await sleep(3000);
console.log('聚焦后:', JSON.stringify(await snap(), null, 2));

console.log('\n>>> 在编辑器里输入一个字符（触发 X 展开工具栏）');
await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!e) return 'no-editor';
      e.focus();
      document.execCommand('insertText', false, 'x');
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
      return 'typed';
    }
  })
`);
await sleep(3000);
console.log('输入后:', JSON.stringify(await snap(), null, 2));

console.log('\n=== 结论 ===');
const s = await snap();
if (s.fileInputs > 0) console.log('✅ 聚焦/输入后 fileInput 出现了 —— 是时序问题，attachMedia 之前需要先聚焦');
else console.log('❌ 内联回复框上确实没有 fileInput —— X 的回复框可能不支持从这里挂媒体');

// 清理输入的字符
await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!e) return;
      e.focus();
      const sel = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(e); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('delete', false);
    }
  })
`);

process.exit(0);
