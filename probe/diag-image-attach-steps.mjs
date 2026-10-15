// 直接测：X_POST 带真实生图（约 1MB）到底卡在哪一步。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 300000) => page.eval(expr, { timeoutMs });
const tabId = await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);
console.log('工作标签页:', tabId);

// 1. 生图
console.log('\n=== 1. 生图 ===');
const t0 = Date.now();
const img = await ev(`
  chrome.runtime.sendMessage({ type: 'AI_IMAGE', prompt: 'a small blue bird on a wire, soft daylight' })
    .then(r => { window.__img = r.dataUrl || ''; return JSON.stringify({ ok: r.ok, bytes: Math.round((r.dataUrl||'').length * 0.75), mime: (r.dataUrl||'').slice(5, (r.dataUrl||'').indexOf(';')) }); })
    .catch(e => 'ERR: ' + e.message)
`, 240000);
console.log(`耗时 ${Math.round((Date.now() - t0) / 1000)}s  ${img}`);

// 2. 到首页
console.log('\n=== 2. 导航到首页 ===');
await ev(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
await sleep(13000);
console.log('页面:', await ev(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => ({
    path: location.pathname,
    editors: document.querySelectorAll('[data-testid="tweetTextarea_0"]').length,
    fileInputs: document.querySelectorAll('[data-testid="fileInput"]').length,
    scrollY: Math.round(window.scrollY)
  }) }).then(r => JSON.stringify(r[0]?.result))
`));

// 3. 逐步手动模拟 attachMedia，看哪一步卡
console.log('\n=== 3. 手动分步执行 attachMedia ===');

const step = async (label, expr, timeoutMs = 60000) => {
  const t = Date.now();
  const out = await ev(expr, timeoutMs).catch(e => 'TIMEOUT/ERR: ' + e.message);
  console.log(`  ${label}: ${Math.round((Date.now() - t) / 1000)}s  ${String(out).slice(0, 120)}`);
  return out;
};

await step('填文字', `
  (() => {
    const e = document.querySelector('[data-testid="tweetTextarea_0"]');
    e.scrollIntoView({ block: 'center' });
    e.focus();
    document.execCommand('insertText', false, 'image probe');
    e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'image probe' }));
    return 'ok';
  })()
`);

await step('fetch + 构造 File', `
  (async () => {
    const t = performance.now();
    const blob = await (await fetch(window.__img)).blob();
    const file = new File([blob], 'probe.png', { type: blob.type });
    window.__file = file;
    return JSON.stringify({ ms: Math.round(performance.now() - t), size: file.size, type: file.type });
  })()
`, 60000);

await step('派发 input/change', `
  (() => {
    const input = document.querySelector('[data-testid="fileInput"]');
    if (!input) return 'no-input';
    const dt = new DataTransfer();
    dt.items.add(window.__file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'dispatched';
  })()
`, 60000);

// 观察附件出现
for (let i = 1; i <= 8; i += 1) {
  await sleep(2500);
  const s = await ev(`
    chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => ({
      attachments: document.querySelectorAll('[data-testid="attachments"]').length,
      imgs: document.querySelectorAll('[data-testid="attachments"] img').length,
      editor: (document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '').trim().slice(0, 20)
    }) }).then(r => JSON.stringify(r[0]?.result))
  `);
  console.log(`  ${i * 2.5}s 附件=${JSON.parse(s).attachments} 图=${JSON.parse(s).imgs} 编辑器="${JSON.parse(s).editor}"`);
  if (JSON.parse(s).attachments > 0) break;
}

// 清理
await ev(`chrome.tabs.sendMessage(${tabId}, { type: 'X_CLEAR_DRAFT' }).catch(() => {})`);
process.exit(0);
