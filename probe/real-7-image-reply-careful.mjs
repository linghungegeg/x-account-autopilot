// 带图评论：单标签页，逐步记录状态，确认图片到底有没有附上。
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

// 固定用唯一那个 x.com 标签页
const tabId = await ext.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)
`);
console.log('工作标签页:', tabId);

const send = (msg, timeoutMs = 120000) => ext.eval(`
  chrome.tabs.sendMessage(${tabId}, ${JSON.stringify(msg)})
    .then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
`, { timeoutMs });

const peek = () => ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => ({
      url: location.pathname,
      editor: (document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '').trim().slice(0, 30),
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      attachments: document.querySelectorAll('[data-testid="attachments"]').length,
      attachImgs: document.querySelectorAll('[data-testid="attachments"] img').length,
      progress: !!document.querySelector('[data-testid="progressBar-bar"]'),
      submitBtn: (() => {
        const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].find(x => x.getClientRects().length);
        return b ? { tid: b.getAttribute('data-testid'), disabled: b.disabled || b.getAttribute('aria-disabled') } : null;
      })()
    })
  }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);

const goto = async (url, ms) => {
  await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`);
  await sleep(ms);
};

// ---------------------------------------------------------------- 1. 发帖
console.log('\n=== 1. 发测试帖 ===');
await goto('https://x.com/home', 11000);
console.log('发帖结果:', await send({ type: 'X_POST', text: '（带图回复测试）', mediaDataUrl: '', dryRun: false, humanize: { humanize: false } }));

await goto('https://x.com/linghungg', 13000);
const href = await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
      for (const a of arts) {
        if (!(a.querySelector('[data-testid="tweetText"]')?.innerText || '').includes('带图回复测试')) continue;
        return [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || null;
      }
      return null;
    }
  }).then(r => r[0]?.result).catch(e => 'ERR: ' + e.message)
`);
console.log('测试帖:', href);
if (!href || String(href).startsWith('ERR')) { console.log('❌ 找不到测试帖'); process.exit(1); }

// ---------------------------------------------------------------- 2. 手动逐步走带图回复
console.log('\n=== 2. 到帖子详情页，点 reply ===');
await goto(`https://x.com${href}`, 13000);
console.log('导航后:', await peek());

await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const a = document.querySelector('[data-testid="tweet"]');
      a?.querySelector('[data-testid="reply"]')?.click();
      return true;
    }
  })
`);
await sleep(3500);
console.log('点 reply 后:', await peek());

console.log('\n=== 3. 先填文字（触发工具栏渲染）===');
await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const e = document.querySelector('[data-testid="tweetTextarea_0"]');
      e.focus();
      document.execCommand('insertText', false, '带图测试');
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '带图测试' }));
      return true;
    }
  })
`);
await sleep(2500);
console.log('填字后:', await peek());

console.log('\n=== 4. 塞入图片 ===');
await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    args: [${JSON.stringify(DATA_URL)}],
    func: async (dataUrl) => {
      const input = document.querySelector('[data-testid="fileInput"]');
      if (!input) return 'no-input';
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'test.png', { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'dispatched';
    }
  }).then(r => r[0]?.result).catch(e => 'ERR: ' + e.message)
`);
for (let i = 1; i <= 8; i += 1) {
  await sleep(2000);
  const s = JSON.parse(await peek());
  console.log(`  ${i * 2}s  附件=${s.attachments} 附件图=${s.attachImgs} 进度条=${s.progress} 提交按钮=${JSON.stringify(s.submitBtn)}`);
  if (s.attachments > 0 && !s.progress) break;
}

console.log('\n=== 5. 提交前最后确认 ===');
const before = await peek();
console.log(before);

console.log('\n=== 6. 点提交 ===');
const clicked = await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => {
      const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].find(x => x.getClientRects().length);
      if (!b) return 'no-button';
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return 'disabled';
      b.click();
      return 'clicked';
    }
  }).then(r => r[0]?.result).catch(e => 'ERR: ' + e.message)
`);
console.log('点击:', clicked);

await sleep(8000);
console.log('提交后:', await peek());

console.log('\n=== 7. 找这条回复自己的地址 ===');
await goto('https://x.com/linghungg/with_replies', 15000);
const found = await ext.eval(`
  chrome.scripting.executeScript({
    target: { tabId: ${tabId} },
    func: () => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => {
      const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
      return {
        href: link,
        text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 25),
        photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length
      };
    })
  }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);
console.log(found);

const list = (() => { try { return JSON.parse(found); } catch { return []; } })();
const mine = list.find(t => t.text.includes('带图测试'));
console.log('\n=== 结论 ===');
console.log(mine ? (mine.photos > 0 ? `✅ 带图评论确认带图（photos=${mine.photos}）` : '❌ 评论发出去了但没图') : '⚠️ 没在时间线里找到这条回复');

process.exit(0);
