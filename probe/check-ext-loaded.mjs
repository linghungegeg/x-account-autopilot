// 启动后检查：扩展加载了吗？ID 变了吗？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXPECTED = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('当前页面:');
targets.filter(t => t.type === 'page').forEach(t => console.log('  ' + t.url.slice(0, 90)));

// 试访问已知 ID 的扩展页
const page = await cdp.newPage(`chrome-extension://${EXPECTED}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);
const title = await page.eval(`document.title`).catch(e => 'ERR: ' + e.message);
console.log(`\n用 ID ${EXPECTED} 打开设置页: ${title}`);

if (title && title.includes('养号')) {
  console.log('✅ 扩展已加载（ID 没变）');
  console.log('版本:', await page.eval(`chrome.runtime.getManifest().version`));
  console.log('后台:', await page.eval(`
    chrome.runtime.sendMessage({ type: 'GET_ALL' })
      .then(r => JSON.stringify({ ok: r.ok, preset: r.state?.presetLabel, keywords: r.state?.keywords, queue: r.state?.queue?.length, pending: r.state?.pendingCount }))
      .catch(e => 'ERR: ' + e.message)
  `));
} else {
  console.log('❌ 打不开，扩展可能没加载或 ID 变了');
}

process.exit(0);
