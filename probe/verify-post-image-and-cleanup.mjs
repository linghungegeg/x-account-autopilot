// 确认发帖带图 + 清理所有测试内容。
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

const goto = async (url, ms) => { await ext.eval(`chrome.tabs.update(${tabId}, { url: ${JSON.stringify(url)} })`); await sleep(ms); };

// ---------------------------------------------------------------- 1. 确认发帖带图
console.log('=== 1. 主页看所有帖子（含图情况）===');
await goto('https://x.com/linghungg', 16000);
const posts = await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => {
  const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h)) || '';
  return {
    href: link,
    text: (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 22),
    photos: a.querySelectorAll('[data-testid="tweetPhoto"]').length
  };
})`);
console.log(posts);

const list = (() => { try { return JSON.parse(posts); } catch { return []; } })();
const goodWithImage = list.filter(p => p.text === 'good' && p.photos > 0);
console.log(`\n带图的 "good" 帖子: ${goodWithImage.length} 条`);
goodWithImage.forEach(p => console.log(`  ✅ ${p.href}  photos=${p.photos}`));

// ---------------------------------------------------------------- 2. 清理
console.log('\n=== 2. 清理测试内容 ===');
const MARKERS = ['good', '带图测试', '带图监控', '带图回复测试', '带图评论测试帖', '（自动化测试）'];

const del = async marker => {
  const r = await ext.eval(`
    (async () => {
      const [tab] = await chrome.tabs.query({ url: ['https://x.com/*'] });
      const [{ result: opened }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [${JSON.stringify(marker)}],
        func: (m) => {
          const art = [...document.querySelectorAll('[data-testid="tweet"]')]
            .find(a => (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim() === m);
          const caret = art?.querySelector('[data-testid="caret"]');
          if (!caret) return 'not-found';
          caret.click();
          return 'opened';
        }
      });
      if (opened !== 'opened') return opened;
      await new Promise(r => setTimeout(r, 1500));
      const [{ result: d }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const item = [...document.querySelectorAll('[role="menuitem"]')].find(i => /^delete|删除/i.test((i.innerText || '').trim()));
          if (!item) return 'no-delete';
          item.click();
          return 'clicked';
        }
      });
      if (d !== 'clicked') return d;
      await new Promise(r => setTimeout(r, 1500));
      const [{ result: c }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const b = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          if (!b) return 'no-confirm';
          b.click();
          return 'deleted';
        }
      });
      return c;
    })()
  `, { timeoutMs: 60000 }).catch(e => 'ERR: ' + e.message);
  return r;
};

for (let round = 1; round <= 2; round += 1) {
  for (const url of ['https://x.com/linghungg', 'https://x.com/linghungg/with_replies']) {
    await goto(url, 14000);
    for (const m of MARKERS) {
      const r = await del(m);
      if (r === 'deleted') console.log(`  删除 "${m}" (${url.includes('replies') ? '回复' : '帖子'})`);
      await sleep(2500);
    }
  }
}

// ---------------------------------------------------------------- 3. 收尾
console.log('\n=== 3. 清理后 ===');
await goto('https://x.com/linghungg', 15000);
console.log(await ev(`() => [...document.querySelectorAll('[data-testid="tweet"]')].map(a => (a.querySelector('[data-testid="tweetText"]')?.innerText || '').trim().slice(0, 25))`));

console.log('\n总开关:', await ext.eval(`chrome.runtime.sendMessage({type:'SET_ENABLED', enabled:false}).then(r => JSON.stringify({ok:r.ok, enabled:r.state?.behavior?.enabled}))`));

process.exit(0);
