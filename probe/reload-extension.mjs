// 点击 chrome://extensions 里的「重新加载」，然后确认 service worker 是否注册成功。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage('chrome://extensions/');
await page.send('Page.enable');
await sleep(4000);

const readItem = `(() => {
  const manager = document.querySelector('extensions-manager');
  const list = manager?.shadowRoot?.querySelector('extensions-item-list');
  const items = [...(list?.shadowRoot?.querySelectorAll('extensions-item') || [])];
  const item = items.find(i => i.id === ${JSON.stringify(EXT_ID)});
  if (!item) return { error: '找不到扩展项' };
  const sr = item.shadowRoot;
  return {
    id: item.id,
    name: sr.querySelector('#name')?.textContent?.trim(),
    enabled: !!sr.querySelector('#enableToggle')?.checked,
    errorsText: sr.querySelector('#errors-button')?.textContent?.trim() || '',
    hasReloadButton: !!sr.querySelector('#dev-reload-button')
  };
})()`;

console.log('=== 重新加载前 ===');
console.log(JSON.stringify(await page.eval(readItem), null, 2));

// 点重新加载
console.log('\n>>> 点击「重新加载」');
const clicked = await page.eval(`(() => {
  const manager = document.querySelector('extensions-manager');
  const list = manager?.shadowRoot?.querySelector('extensions-item-list');
  const items = [...(list?.shadowRoot?.querySelectorAll('extensions-item') || [])];
  const item = items.find(i => i.id === ${JSON.stringify(EXT_ID)});
  const btn = item?.shadowRoot?.querySelector('#dev-reload-button');
  if (!btn) return false;
  btn.click();
  return true;
})()`);
console.log('点击结果:', clicked);

await sleep(6000);

console.log('\n=== 重新加载后 ===');
console.log(JSON.stringify(await page.eval(readItem), null, 2));

// service worker 是否起来了
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const sw = targets.find(t => t.type === 'service_worker' && t.url.includes('service-worker.js'));
console.log('\nService Worker target:', sw ? `✅ ${sw.url}` : '⚠️ 还没有（可能休眠，点一下扩展图标会唤醒）');

process.exit(0);
