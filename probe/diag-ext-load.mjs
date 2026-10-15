// 查清扩展到底加载了没有、从哪个目录、有没有报错。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;

const cdp = await connect({ port: PORT });

console.log('=== 1. CDP 目标（扩展会以 service_worker / page 出现）===');
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
targets.forEach(t => {
  console.log(`  [${t.type}] ${t.url.slice(0, 100)}`);
});

const extTargets = targets.filter(t => t.url.startsWith('chrome-extension://'));
console.log(`\n扩展相关目标: ${extTargets.length} 个`);

// 提取扩展 ID
const ids = new Set();
for (const t of extTargets) {
  const m = t.url.match(/^chrome-extension:\/\/([a-p]+)/);
  if (m) ids.add(m[1]);
}
console.log('发现扩展 ID:', [...ids].join(', ') || '(无)');

console.log('\n=== 2. 已知 ID 能不能打开 ===');
const KNOWN = 'kfdgfjbdhajdfflcolociedlbcameink';
for (const id of new Set([...ids, KNOWN])) {
  try {
    const p = await cdp.newPage(`chrome-extension://${id}/manifest.json`);
    await p.send('Page.enable');
    await sleep(2500);
    const text = await p.eval(`document.body.innerText.slice(0, 120)`).catch(e => 'ERR');
    const isJson = text && text.includes('manifest_version');
    console.log(`  ${id}: ${isJson ? '✅ 可访问' : '❌ ' + String(text).slice(0, 60)}`);
    if (isJson) {
      const v = await p.eval(`JSON.parse(document.body.innerText).version`).catch(() => '?');
      console.log(`     版本: ${v}`);
    }
  } catch (e) {
    console.log(`  ${id}: ❌ ${e.message.slice(0, 60)}`);
  }
}

console.log('\n=== 3. chrome://extensions 里显示什么 ===');
try {
  const extPage = await cdp.newPage('chrome://extensions/');
  await extPage.send('Page.enable');
  await sleep(4000);
  const info = await extPage.eval(`
    (() => {
      const mgr = document.querySelector('extensions-manager');
      const list = mgr?.shadowRoot?.querySelector('extensions-item-list');
      const items = list?.shadowRoot?.querySelectorAll('extensions-item') || [];
      const out = [...items].map(item => {
        const sr = item.shadowRoot;
        return {
          id: item.id,
          name: sr?.querySelector('#name')?.textContent?.trim(),
          version: sr?.querySelector('#version')?.textContent?.trim(),
          errors: sr?.querySelector('#errors-button')?.textContent?.trim() || '',
          enabled: !sr?.querySelector('#enableToggle')?.hasAttribute('aria-pressed') || sr?.querySelector('#enableToggle')?.getAttribute('aria-pressed') === 'true'
        };
      });
      return JSON.stringify({
        developerMode: mgr?.shadowRoot?.querySelector('#devMode')?.hasAttribute('checked') ?? null,
        count: out.length,
        items: out
      }, null, 2);
    })()
  `).catch(e => 'ERR: ' + e.message);
  console.log(info);
} catch (e) {
  console.log('  打不开 chrome://extensions: ' + e.message);
}

process.exit(0);
