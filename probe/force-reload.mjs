// 强制重载扩展：chrome.runtime.reload() 比点 UI 按钮更彻底。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });

// 先确认没在跑旧版本
const before = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await before.send('Page.enable');
await sleep(2000);
console.log('>>> 调用 chrome.runtime.reload()');
await before.eval(`(() => { chrome.runtime.reload(); return true; })()`).catch(() => {});
await sleep(6000);

// 重开一个页面看新版本
const after = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await after.send('Page.enable');
await sleep(3000);

const loaded = await after.eval(`
  fetch(chrome.runtime.getURL('src/background/service-worker.js'))
    .then(r => r.text())
    .then(t => JSON.stringify({
      length: t.length,
      buggy: /normalizeKeywords,\\s*\\n\\s*normalizeList,/.test(t),
      fixed: /needsReview,\\s*\\n\\s*normalizeList,/.test(t)
    }))
    .catch(e => 'ERR: ' + e.message)
`);
console.log('重载后加载的 SW:', loaded);

const check = await after.eval(`
  import(chrome.runtime.getURL('src/background/service-worker.js'))
    .then(m => 'OK 加载成功，导出 ' + Object.keys(m).length + ' 项')
    .catch(e => 'FAIL ' + (e && (e.message || e.toString())))
`).catch(e => 'FAIL(外层) ' + e.message);
console.log('动态 import:', check);

// 扩展管理页看错误状态
const extPage = await cdp.newPage('chrome://extensions/');
await extPage.send('Page.enable');
await sleep(4000);
const item = await extPage.eval(`(() => {
  const manager = document.querySelector('extensions-manager');
  const list = manager?.shadowRoot?.querySelector('extensions-item-list');
  const items = [...(list?.shadowRoot?.querySelectorAll('extensions-item') || [])];
  const it = items.find(i => i.id === ${JSON.stringify(EXT_ID)});
  if (!it) return { error: '找不到' };
  const sr = it.shadowRoot;
  return {
    name: sr.querySelector('#name')?.textContent?.trim(),
    version: sr.querySelector('#version')?.textContent?.trim(),
    errorsText: sr.querySelector('#errors-button')?.textContent?.trim() || '(无错误)'
  };
})()`);
console.log('\n扩展管理页状态:', JSON.stringify(item, null, 2));

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sw = targets.find(t => t.type === 'service_worker' && t.url.includes('service-worker.js'));
console.log('Service Worker target:', sw ? `✅ ${sw.url}` : '（未激活）');

process.exit(0);
