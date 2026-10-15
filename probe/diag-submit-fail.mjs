// 提交后编辑器没清空：页面现在什么状态？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const ev = (expr, timeoutMs = 60000) => ext.eval(expr, { timeoutMs });

// 先停机
console.log('停机:', await ev(`chrome.runtime.sendMessage({type:'SET_ENABLED',enabled:false}).then(r=>JSON.stringify({ok:r.ok}))`));
console.log('回演练:', await ev(`chrome.runtime.sendMessage({type:'SAVE_BEHAVIOR',behavior:{dryRun:true}}).then(r=>JSON.stringify({ok:r.ok}))`));

const tabs = JSON.parse(await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => JSON.stringify(l.map(t => ({ id: t.id, url: t.url }))))`));
console.log('\n=== x.com 标签页 ===');
for (const t of tabs) {
  const info = await ev(`
    chrome.scripting.executeScript({
      target: { tabId: ${t.id} },
      func: () => {
        const editors = [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')];
        const btns = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')]
          .map(b => ({ tid: b.getAttribute('data-testid'), visible: b.getClientRects().length > 0, disabled: b.disabled || b.getAttribute('aria-disabled'), offscreen: !!b.closest('[data-testid="inline_reply_offscreen"]') }));
        const toast = document.querySelector('[data-testid="toast"]');
        return {
          path: location.pathname,
          scrollY: Math.round(window.scrollY),
          editors: editors.map(e => (e.innerText || '').trim().slice(0, 45)),
          buttons: btns,
          toast: (toast?.innerText || '').trim().slice(0, 100),
          // 有没有"发送中/失败"之类的提示
          alertText: (document.querySelector('[role="alert"]')?.innerText || '').slice(0, 120)
        };
      }
    }).then(r => JSON.stringify(r[0]?.result, null, 2)).catch(e => 'ERR: ' + e.message)
  `, 30000).catch(e => 'TIMEOUT: ' + e.message);
  console.log(`\n  [${t.id}] ${t.url}`);
  console.log(info);
}

process.exit(0);
