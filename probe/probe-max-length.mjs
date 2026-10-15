// 实测 X 的发帖长度上限（含中英文加权差异）。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, args = '[]') => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn}, args: ${args} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);

const goto = async (url, ms) => { await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`); await sleep(ms); };

// 先看发帖框附近有没有计数器元素
await goto('https://x.com/home', 12000);

console.log('=== 先找计数器元素 ===');
console.log(await ev(`() => {
  const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
  const container = editor?.closest('[data-testid="tweetTextarea_0RichTextInputContainer"]');
  // 往上找 composer 容器
  let composer = editor;
  for (let i = 0; i < 10 && composer; i += 1) {
    if (composer.querySelector('[data-testid="tweetButtonInline"]')) break;
    composer = composer.parentElement;
  }
  const rings = composer ? [...composer.querySelectorAll('[role="progressbar"], svg circle, [data-testid*="progress"]')] : [];
  return {
    hasComposer: !!composer,
    ringCount: rings.length,
    ringInfo: rings.slice(0, 4).map(r => ({
      tag: r.tagName,
      tid: r.getAttribute('data-testid'),
      role: r.getAttribute('role'),
      aria: r.getAttribute('aria-valuenow') || r.getAttribute('aria-label')
    })),
    // 计数器通常是 svg 附近的 span
    footerText: composer ? (composer.innerText || '').replace(/\\n/g, ' | ').slice(0, 120) : null
  };
}`));

// 逐步加大长度，观察按钮何时禁用
const test = async (label, char) => {
  console.log(`\n=== ${label} ===`);
  for (const n of [200, 260, 280, 281, 300, 400, 560, 561]) {
    await ev(`() => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      e.focus();
      const sel = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(e); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('delete', false);
      return true;
    }`);
    await sleep(400);
    await ev(`(ch, count) => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      e.focus();
      document.execCommand('insertText', false, ch.repeat(count));
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch.repeat(count) }));
      return true;
    }`, `[${JSON.stringify(char)}, ${n}]`);
    await sleep(900);

    const s = await ev(`() => {
      const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
      let composer = editor;
      for (let i = 0; i < 10 && composer; i += 1) {
        if (composer.querySelector('[data-testid="tweetButtonInline"]')) break;
        composer = composer.parentElement;
      }
      const btn = composer?.querySelector('[data-testid="tweetButtonInline"]');
      // 计数器：进度环的 aria 或旁边文字
      const ring = composer?.querySelector('[role="progressbar"]');
      return {
        len: (editor.innerText || '').length,
        disabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled')) : null,
        ringAria: ring?.getAttribute('aria-valuenow') || ring?.getAttribute('aria-label') || null,
        composerText: (composer?.innerText || '').replace(/\\n/g, '|').slice(-60)
      };
    }`);
    console.log(`  ${String(n).padStart(3)} 个${char}: ${s}`);
    if (JSON.parse(s).disabled === true || JSON.parse(s).disabled === 'true') {
      console.log(`  ⛔ 在这个长度被禁用`);
      break;
    }
  }
};

await test('英文 a', 'a');
await test('中文 中', '中');

// 清理
await ev(`() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!e) return;
  e.focus();
  const s = window.getSelection(); const r = document.createRange();
  r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r);
  document.execCommand('delete', false);
  return true;
}`);

process.exit(0);
