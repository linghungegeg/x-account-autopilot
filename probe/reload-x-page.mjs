// 刷新 x.com 页面并确认内容脚本重新注入。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3500);

const ev = (expr, timeoutMs = 120000) => page.eval(expr, { timeoutMs });

console.log('刷新 x.com:', await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] })
    .then(async tabs => {
      for (const t of tabs) await chrome.tabs.reload(t.id);
      return JSON.stringify({ reloaded: tabs.length });
    })
    .catch(e => 'ERR: ' + e.message)
`));

await sleep(12000);

console.log('页面状态:', await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] })
    .then(tabs => chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => ({
        path: location.pathname,
        ready: document.readyState,
        hasColumn: !!document.querySelector('[data-testid="primaryColumn"]')
      })
    }))
    .then(r => JSON.stringify(r[0]?.result))
    .catch(e => 'ERR: ' + e.message)
`));

console.log('内容脚本响应:', await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] })
    .then(tabs => Promise.race([
      chrome.tabs.sendMessage(tabs[0].id, { type: 'X_PING' }).then(r => 'OK ' + r.url).catch(e => 'ERR: ' + e.message),
      new Promise(r => setTimeout(() => r('TIMEOUT(8s)'), 8000))
    ]))
`));

console.log('后台状态:', await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    ok: r.ok, enabled: r.state.behavior.enabled, dryRun: r.state.behavior.dryRun,
    humanizePauseMaxSec: r.state.behavior.humanizePauseMaxSec,
    humanizeScrollMax: r.state.behavior.humanizeScrollMax,
    planEnabled: r.state.postPlan.enabled, pending: r.state.pendingCount
  }))
`));

process.exit(0);
