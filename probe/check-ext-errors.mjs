// 查扩展在 Chrome 里的状态：是否启用、有没有报错、service worker 在不在。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });

// ---------------------------------------------------------- service worker
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const workers = targets.filter(t => t.type === 'service_worker' || t.type === 'worker');
console.log('=== 后台 target ===');
if (!workers.length) console.log('  ⚠️ 没有 service worker target（可能休眠）');
workers.forEach(w => console.log(`  ${w.type}  ${w.url}`));

// ---------------------------------------------------------- chrome://extensions
const page = await cdp.newPage('chrome://extensions/');
await page.send('Page.enable');
await sleep(4000);

const info = await page.eval(`(() => {
  const manager = document.querySelector('extensions-manager');
  const list = manager?.shadowRoot?.querySelector('extensions-item-list');
  const items = [...(list?.shadowRoot?.querySelectorAll('extensions-item') || [])];
  const item = items.find(i => i.id === ${JSON.stringify(EXT_ID)});
  if (!item) return JSON.stringify({ error: '找不到扩展项', foundIds: items.map(i => i.id) });
  const sr = item.shadowRoot;
  const errBtn = sr.querySelector('#errors-button');
  return JSON.stringify({
    id: item.id,
    name: sr.querySelector('#name')?.textContent?.trim(),
    version: sr.querySelector('#version')?.textContent?.trim(),
    enabled: !!sr.querySelector('#enableToggle')?.checked,
    errorsButton: errBtn?.textContent?.trim() || '(无)',
    errorsHidden: errBtn?.hidden ?? null,
    hasServiceWorkerLink: !!sr.querySelector('#service-worker-command'),
    warnings: [...sr.querySelectorAll('.warning')].map(w => w.textContent.trim()).slice(0, 5)
  });
})()`);
console.log('\n=== chrome://extensions ===');
console.log(JSON.stringify(JSON.parse(info), null, 2));

// ---------------------------------------------------------- 后台自检
const opts = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await opts.send('Page.enable');
await sleep(3000);
const health = await opts.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    ok: r.ok,
    version: chrome.runtime.getManifest().version,
    name: chrome.runtime.getManifest().name,
    permissions: chrome.runtime.getManifest().permissions,
    hostPermissions: chrome.runtime.getManifest().host_permissions,
    hasState: !!r.state,
    lastError: chrome.runtime.lastError?.message || null
  })).catch(e => 'ERR: ' + e.message)
`);
console.log('\n=== 后台自检 ===');
console.log(health);
process.exit(0);
