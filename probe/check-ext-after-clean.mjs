// 旧目录被删后，浏览器里注册的扩展还能用吗？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 30000) => page.eval(expr, { timeoutMs });

console.log('扩展页面标题:', await ev(`document.title`).catch(e => 'ERR: ' + e.message));
console.log('后台响应:', await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' })
    .then(r => JSON.stringify({ ok: r.ok, preset: r.state?.presetLabel, version: chrome.runtime.getManifest().version }))
    .catch(e => 'ERR: ' + e.message)
`).catch(e => 'ERR: ' + e.message));

// 检查注册的路径
const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('\n可访问的扩展页面:');
list.filter(t => t.url.startsWith('chrome-extension://')).forEach(t => console.log('  ' + t.url.slice(0, 80)));

process.exit(0);
