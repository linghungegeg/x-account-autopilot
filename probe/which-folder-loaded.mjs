// 判断扩展到底从哪个目录加载：用只在 E:\x 里、不在 zip 里的文件做探针。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

// mockup.html / package.json / probe/ / tests/ 都只存在于 E:\x，没打进 zip
const probes = ['mockup.html', 'package.json', 'probe/cdp.js', 'tests/wiring.test.mjs', 'scripts/package.mjs', 'README.md', 'manifest.json'];

const result = await page.eval(`
  Promise.all(${JSON.stringify(probes)}.map(p =>
    fetch(chrome.runtime.getURL(p))
      .then(r => p + ' → HTTP ' + r.status)
      .catch(() => p + ' → 读取失败')
  )).then(a => a.join('\\n'))
`);
console.log('=== 文件可达性 ===');
console.log(result);

const fromWorkspace = await page.eval(`
  fetch(chrome.runtime.getURL('mockup.html')).then(r => r.ok).catch(() => false)
`);
console.log('\n判定:', fromWorkspace
  ? '✅ 从 E:\\x 加载（mockup.html 可读）'
  : '❌ 不是从 E:\\x 加载的 —— 是解压出来的副本，所以我改 E:\\x 不影响它');

// 从扩展管理页挖出安装路径
const extPage = await cdp.newPage('chrome://extensions/');
await extPage.send('Page.enable');
await sleep(4000);

const texts = await extPage.eval(`(() => {
  const manager = document.querySelector('extensions-manager');
  const list = manager?.shadowRoot?.querySelector('extensions-item-list');
  const items = [...(list?.shadowRoot?.querySelectorAll('extensions-item') || [])];
  const it = items.find(i => i.id === ${JSON.stringify(EXT_ID)});
  if (!it?.shadowRoot) return [];
  const out = [];
  const walk = (node, depth) => {
    if (!node || depth > 8) return;
    if (node.nodeType === 3 && node.textContent.trim()) out.push(node.textContent.trim());
    if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
    for (const c of node.childNodes) walk(c, depth);
  };
  walk(it.shadowRoot, 0);
  return [...new Set(out)];
})()`);

console.log('\n=== 扩展卡片上的文本（找路径）===');
texts.forEach(t => console.log('  ' + t.slice(0, 200)));

process.exit(0);
