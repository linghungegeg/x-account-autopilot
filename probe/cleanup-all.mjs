// 清理所有测试内容。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);
const tabId = await ext.eval(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);

const MARKERS = ['带图测试', '带图监控', '带图回复测试', '带图评论测试帖', '（自动化测试）', 'good'];

const deleteByMarker = async marker => {
  const result = await ext.eval(`
    (async () => {
      const [tab] = await chrome.tabs.query({ url: ['https://x.com/*'] });
      const [{ result: opened }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [${JSON.stringify(marker)}],
        func: (m) => {
          const arts = [...document.querySelectorAll('[data-testid="tweet"]')];
          const art = arts.find(a => (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim() === m);
          const caret = art?.querySelector('[data-testid="caret"]');
          if (!caret) return 'not-found';
          caret.click();
          return 'menu-opened';
        }
      });
      if (opened !== 'menu-opened') return opened;
      await new Promise(r => setTimeout(r, 1500));
      const [{ result: del }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const item = [...document.querySelectorAll('[role="menuitem"]')].find(i => /^delete|删除/i.test((i.innerText || '').trim()));
          if (!item) return 'no-delete-item';
          item.click();
          return 'delete-clicked';
        }
      });
      if (del !== 'delete-clicked') return del;
      await new Promise(r => setTimeout(r, 1500));
      const [{ result: ok }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const b = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          if (!b) return 'no-confirm';
          b.click();
          return 'deleted';
        }
      });
      return ok;
    })()
  `, { timeoutMs: 60000 }).catch(e => 'ERR: ' + e.message);
  return result;
};

// 在主页和时间线各扫几轮
for (let round = 1; round <= 3; round += 1) {
  console.log(`\n=== 第 ${round} 轮 ===`);
  for (const url of ['https://x.com/linghungg', 'https://x.com/linghungg/with_replies']) {
    await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`);
    await sleep(13000);
    for (const marker of MARKERS) {
      const r = await deleteByMarker(marker);
      if (r === 'deleted') console.log(`  ✅ 已删除 "${marker}" (${url.includes('replies') ? '回复' : '帖子'})`);
      await sleep(2500);
    }
  }
}

// 最终检查
console.log('\n=== 清理后 ===');
for (const url of ['https://x.com/linghungg', 'https://x.com/linghungg/with_replies']) {
  await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`);
  await sleep(13000);
  const left = await ext.eval(`
    chrome.scripting.executeScript({
      target: { tabId: ${tabId} },
      func: () => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 30))
    }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
  `);
  console.log(`  ${url.includes('replies') ? '/with_replies' : '/linghungg'}: ${left}`);
}

console.log('\n=== 关掉总开关 ===');
console.log(await ext.eval(`chrome.runtime.sendMessage({type:'SET_ENABLED', enabled:false}).then(r => JSON.stringify({ok:r.ok, enabled:r.state?.behavior?.enabled}))`));

process.exit(0);
