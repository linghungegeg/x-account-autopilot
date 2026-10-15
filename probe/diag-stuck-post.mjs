// 排查卡住的原因：工作标签页现在什么状态？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const tabs = JSON.parse(await ext.eval(`chrome.tabs.query({}).then(l => JSON.stringify(l.map(t => ({ id: t.id, url: (t.url||'').slice(0,80), status: t.status }))))`));
console.log('=== 所有标签页 ===');
tabs.forEach(t => console.log(`  [${t.id}] ${t.status}  ${t.url}`));

const xTabs = tabs.filter(t => t.url.includes('x.com'));
for (const t of xTabs) {
  const info = await ext.eval(`
    chrome.scripting.executeScript({
      target: { tabId: ${t.id} },
      func: () => ({
        url: location.pathname,
        editor: (document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '').trim().slice(0, 40),
        attachments: document.querySelectorAll('[data-testid="attachments"]').length,
        attImgs: document.querySelectorAll('[data-testid="attachments"] img').length,
        progress: !!document.querySelector('[data-testid="progressBar-bar"]'),
        submitBtn: (() => {
          const b = [...document.querySelectorAll('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]')].find(x => x.getClientRects().length);
          return b ? { tid: b.getAttribute('data-testid'), disabled: b.disabled || b.getAttribute('aria-disabled') } : null;
        })(),
        challenge: /^\\/i\\/flow\\//.test(location.pathname)
      })
    }).then(r => JSON.stringify(r[0]?.result)).catch(e => 'ERR: ' + e.message)
  `, { timeoutMs: 30000 }).catch(e => 'TIMEOUT/ERR: ' + e.message);
  console.log(`\n  [${t.id}] ${t.url}`);
  console.log('    ' + info);
}

// 卡住的任务还在吗
console.log('\n=== 卡住的任务 ===');
console.log(await ext.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    current: r.state.current,
    stuckForSec: r.state.current ? Math.round((Date.now() - r.state.current.startedAt) / 1000) : 0
  }))
`));

console.log('\n>>> 清理卡住的任务');
console.log(await ext.eval(`
  chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: true }).then(() =>
    new Promise(r => setTimeout(r, 1000))
  ).then(() => chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: false }))
    .then(r => JSON.stringify({ ok: r.ok, current: r.state?.current }))
`));

process.exit(0);
