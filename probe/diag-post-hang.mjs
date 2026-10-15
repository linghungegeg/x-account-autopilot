// 卡住时看页面状态 + 直接手动调 X_POST 看它卡在哪一步。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const ev = (expr, timeoutMs = 60000) => ext.eval(expr, { timeoutMs });

const state = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    current: r.state.current,
    stuckSec: r.state.current ? Math.round((Date.now() - r.state.current.startedAt)/1000) : 0,
    logs: r.state.logs.slice(0, 6).map(l => l.tag + ' | ' + l.message.slice(0, 70))
  }))
`));
console.log('=== 后台 ===');
console.log(JSON.stringify(state, null, 2));

const tabs = JSON.parse(await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => JSON.stringify(l.map(t => ({ id: t.id, url: t.url }))))`));
console.log('\n=== x.com 标签页 ===');
tabs.forEach(t => console.log(`  [${t.id}] ${t.url}`));

for (const t of tabs) {
  const info = await ev(`
    chrome.scripting.executeScript({
      target: { tabId: ${t.id} },
      func: () => ({
        path: location.pathname,
        editorText: (document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '').trim().slice(0, 50),
        editors: document.querySelectorAll('[data-testid="tweetTextarea_0"]').length,
        scrollY: Math.round(window.scrollY),
        submitBtn: (() => {
          const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].find(x => x.getClientRects().length);
          return b ? { tid: b.getAttribute('data-testid'), disabled: b.disabled || b.getAttribute('aria-disabled') } : null;
        })()
      })
    }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
  `, 20000).catch(e => 'TIMEOUT: ' + e.message);
  console.log(`\n  [${t.id}] ${t.url}`);
  console.log('    ' + info);
}

// 直接测 X_PING 看内容脚本还活着没
console.log('\n=== 内容脚本是否响应 ===');
for (const t of tabs) {
  const ping = await ev(`
    Promise.race([
      chrome.tabs.sendMessage(${t.id}, { type: 'X_PING' }).then(r => 'OK: ' + JSON.stringify({url: r.url})).catch(e => 'ERR: ' + e.message),
      new Promise(r => setTimeout(() => r('TIMEOUT(3s)'), 3000))
    ])
  `, 20000);
  console.log(`  [${t.id}] ${ping}`);
}

console.log('\n>>> 停机 + 清理');
console.log(await ev(`chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: false }).then(r => JSON.stringify({ok:r.ok}))`));
console.log(await ev(`chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: true }).then(() => new Promise(r => setTimeout(r, 500))).then(() => chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: false })).then(r => JSON.stringify({ok:r.ok}))`));

process.exit(0);
