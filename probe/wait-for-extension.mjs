// 打开扩展管理页，然后轮询等待用户手动导入扩展。
// Chrome 137+ 移除了 --load-extension，只能手动加载，所以这里等。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const TIMEOUT_MS = Number(process.env.WAIT_MS) || 8 * 60 * 1000;

const cdp = await connect({ port: PORT });
console.log('已有页面:', cdp.pages.map(p => p.url).join(', '));

// 确保扩展管理页开着
const already = cdp.pages.find(p => p.url.startsWith('chrome://extensions'));
const page = already ? await cdp.attach(already) : await cdp.newPage('chrome://extensions/');
await page.send('Page.enable');
await sleep(2500);
console.log('扩展管理页已就绪\n');
console.log('等待你在页面上点「加载已解压的扩展程序」并选择 E:\\x …');

const started = Date.now();
let found = null;

while (Date.now() - started < TIMEOUT_MS) {
  await sleep(3000);
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
    const ext = list.find(t => t.url.startsWith('chrome-extension://'));
    if (ext) { found = ext; break; }
  } catch { /* 忽略瞬时失败 */ }
}

if (!found) {
  console.log(`\n⏱ 等待超时（${Math.round(TIMEOUT_MS / 60000)} 分钟），扩展还没加载进来。`);
  process.exit(2);
}

const id = new URL(found.url).host;
console.log('\n✅ 检测到扩展！');
console.log('   扩展 ID:', id);
console.log('   目标类型:', found.type);
console.log('   URL:', found.url);

// 再确认一下 SW 和 popup/options 页面都能打开
const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('\n当前扩展相关目标:');
list.filter(t => t.url.startsWith('chrome-extension://')).forEach(t => console.log(`   [${t.type}] ${t.url}`));

console.log('\n扩展 ID 已拿到，可以开始端到端测试了。');
process.exit(0);
