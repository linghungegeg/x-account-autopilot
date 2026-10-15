// 1. progressBar-bar 到底是什么？ 2. 刚提交的回复有没有图？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const ev = (fn, timeoutMs = 120000) => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

// ---------------------------------------------------------------- 1. progressBar-bar 是什么
console.log('=== progressBar-bar 的真实身份 ===');
console.log(await ev(`() => {
  const bar = document.querySelector('[data-testid="progressBar-bar"]');
  if (!bar) return '不存在';
  const chain = [];
  let el = bar;
  for (let i = 0; i < 6 && el; i += 1) {
    chain.push(el.tagName + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '') + (el.getAttribute('role') ? '{' + el.getAttribute('role') + '}' : ''));
    el = el.parentElement;
  }
  return {
    ancestors: chain,
    width: bar.style.width || getComputedStyle(bar).width,
    // 它是不是在发帖按钮里（字数圆环）
    insideSubmitButton: !!bar.closest('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]'),
    insideComposer: !!bar.closest('[data-testid="tweetTextarea_0RichTextInputContainer"]'),
    count: document.querySelectorAll('[data-testid="progressBar-bar"]').length
  };
}`));

// ---------------------------------------------------------------- 2. 刚发的回复有没有图
console.log('\n=== 到 /with_replies 看最新回复 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg/with_replies' })`);
await sleep(16000);

console.log(await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 5).map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 20),
    photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length
  };
})`));

// ---------------------------------------------------------------- 3. 附件预览的 img 会不会变成 pbs.twimg.com
console.log('\n=== 测试：挂图后附件 img 的 src 会不会从 blob: 变成 pbs.twimg.com ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
await sleep(12000);

await ev(`() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  e.focus();
  document.execCommand('insertText', false, 'x');
  e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
  return true;
}`);
await sleep(1500);

const { readFileSync } = await import('node:fs');
const DATA_URL = 'data:image/png;base64,' + readFileSync('icons/icon128.png').toString('base64');

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
      return 'ok';
    }
  })
`);

for (let i = 1; i <= 10; i += 1) {
  await sleep(2000);
  console.log(`  ${i * 2}s  ` + await ev(`() => {
    const att = document.querySelector('[data-testid="attachments"]');
    const img = att?.querySelector('img');
    return JSON.stringify({
      imgs: att ? att.querySelectorAll('img').length : 0,
      src: (img?.getAttribute('src') || '').slice(0, 45),
      isBlob: (img?.getAttribute('src') || '').startsWith('blob:'),
      isPbs: (img?.getAttribute('src') || '').includes('pbs.twimg.com')
    });
  }`));
}

// 清理
await ev(`() => {
  const e = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (e) { e.focus(); const s = window.getSelection(); const r = document.createRange(); r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r); document.execCommand('delete', false); }
  return true;
}`);

process.exit(0);
