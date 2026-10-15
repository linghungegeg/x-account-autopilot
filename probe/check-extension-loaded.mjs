// 诊断：扩展到底有没有被加载进来。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const cdp = await connect({ port: PORT });

// 用浏览器级 CDP 列全部 target（扩展的 SW / 页面都会出现）
const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

const targets = await new Promise(resolve => {
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) resolve(msg.result?.targetInfos || []);
  });
  ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
});

console.log('=== 全部 CDP target ===');
for (const t of targets) {
  console.log(`  [${t.type}] ${t.url.slice(0, 110)}`);
}

const extTargets = targets.filter(t => t.url.startsWith('chrome-extension://'));
console.log(`\n扩展相关 target: ${extTargets.length} 个`);
extTargets.forEach(t => console.log(`  ${t.type}  ${t.url}`));

// 再看 chrome://extensions 页面里列了什么
const page = await cdp.newPage('chrome://extensions/');
await page.send('Page.enable');
await sleep(4000);

const listed = await page.eval(`(() => {
  const manager = document.querySelector('extensions-manager');
  if (!manager?.shadowRoot) return { error: '拿不到 extensions-manager 的 shadowRoot' };
  const list = manager.shadowRoot.querySelector('extensions-item-list');
  if (!list?.shadowRoot) return { error: '拿不到 item-list 的 shadowRoot' };
  const items = [...list.shadowRoot.querySelectorAll('extensions-item')];
  return {
    count: items.length,
    items: items.map(item => {
      const sr = item.shadowRoot;
      return {
        id: item.id,
        name: sr?.querySelector('#name')?.textContent?.trim() || '(无名)',
        enabled: !!sr?.querySelector('#enableToggle')?.checked,
        errors: sr?.querySelector('#errors-button')?.textContent?.trim() || ''
      };
    })
  };
})()`);

console.log('\n=== chrome://extensions 里列出的扩展 ===');
console.log(JSON.stringify(listed, null, 2));

await fetch(`http://127.0.0.1:${PORT}/json/close/${page.target.id}`, { method: 'PUT' }).catch(() => {});
ws.close();
process.exit(0);
