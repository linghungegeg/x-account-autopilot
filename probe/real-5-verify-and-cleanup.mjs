// 确认带图评论真的带图 + 清理测试内容。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => t[0]?.id ?? null)`);

const run = fn => ext.eval(`
  chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${fn} })
    .then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
`);

// ---------------------------------------------------------------- 确认带图评论
console.log('=== 到 /with_replies 确认带图评论 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg/with_replies' })`);
await sleep(13000);

const seen = await run(`() => {
  const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
  return arts.map(a => ({
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 40),
    photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length,
    hasPhotoImg: !!a.querySelector('[data-testid="tweetPhoto"] img')
  }));
}`);
console.log(seen);

const parsed = (() => { try { return JSON.parse(seen); } catch { return []; } })();
const withImageReply = parsed.find(t => t.text.includes('with image'));
console.log('\n带图评论条目:', JSON.stringify(withImageReply));

// ---------------------------------------------------------------- 清理
console.log('\n=== 清理测试内容（删除测试帖和两条评论）===');
const targets = ['（自动化测试）', 'good', 'with image'];

for (const marker of targets) {
  const result = await ext.eval(`
    (async () => {
      const [tab] = await chrome.tabs.query({ url: ['https://x.com/*'] });
      const [{ result: found }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (m) => {
          const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
          const art = arts.find(a => (a.querySelector('[data-testid="tweetText"]')?.innerText || '').includes(m));
          if (!art) return null;
          const caret = art.querySelector('[data-testid="caret"]');
          if (!caret) return null;
          caret.click();
          return true;
        },
        args: [${JSON.stringify(marker)}]
      });
      if (!found) return 'not-found: ' + ${JSON.stringify(marker)};
      await new Promise(r => setTimeout(r, 1200));
      const [{ result: clicked }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const item = [...document.querySelectorAll('[role="menuitem"]')]
            .find(i => /^delete|删除/i.test((i.innerText || '').trim()));
          if (!item) return 'no-delete-item';
          item.click();
          return 'delete-clicked';
        }
      });
      if (clicked !== 'delete-clicked') return clicked;
      await new Promise(r => setTimeout(r, 1200));
      const [{ result: confirmed }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          if (!btn) return 'no-confirm';
          btn.click();
          return 'confirmed';
        }
      });
      return confirmed;
    })()
  `).catch(e => 'ERR: ' + e.message);
  console.log(`  ${marker} → ${result}`);
  await sleep(4000);
}

// ---------------------------------------------------------------- 收尾
console.log('\n=== 清理后 ===');
await ext.eval(`chrome.tabs.update(${tabId}, { url: 'https://x.com/linghungg' })`);
await sleep(12000);
console.log(await run(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => (a.querySelector('[data-testid="tweetText"]')?.innerText || '').slice(0, 45))`));

console.log('\n=== 关掉总开关 ===');
console.log(await ext.eval(`chrome.runtime.sendMessage({type:'SET_ENABLED', enabled:false}).then(r => JSON.stringify({ok:r.ok, enabled:r.state?.behavior?.enabled}))`));

process.exit(0);
