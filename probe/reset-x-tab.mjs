// x.com 标签页渲染进程疑似卡死：关掉重开一个。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3500);

const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });

console.log('1. 列出所有标签页');
console.log(await ev(`chrome.tabs.query({}).then(l => JSON.stringify(l.map(t => ({ id: t.id, url: (t.url||'').slice(0,55), status: t.status })), null, 2))`));

console.log('\n2. 关掉 x.com 标签页');
console.log(await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] })
    .then(tabs => Promise.all(tabs.map(t => chrome.tabs.remove(t.id).then(() => t.id).catch(() => 'fail:' + t.id))))
    .then(r => JSON.stringify(r))
`));
await sleep(3000);

console.log('\n3. 新开一个 x.com');
console.log(await ev(`
  chrome.tabs.create({ url: 'https://x.com/home', active: false })
    .then(t => JSON.stringify({ id: t.id }))
    .catch(e => 'ERR: ' + e.message)
`));
await sleep(16000);

console.log('\n4. 验证页面');
console.log(await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] })
    .then(tabs => tabs.length ? chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => ({ path: location.pathname, ready: document.readyState, hasColumn: !!document.querySelector('[data-testid="primaryColumn"]') })
    }) : [{ result: 'no-tab' }])
    .then(r => JSON.stringify(r[0]?.result))
    .catch(e => 'ERR: ' + e.message)
`, 90000));

console.log('\n5. 内容脚本');
console.log(await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] })
    .then(tabs => Promise.race([
      chrome.tabs.sendMessage(tabs[0].id, { type: 'X_PING' }).then(r => 'OK ' + r.url).catch(e => 'ERR: ' + e.message),
      new Promise(r => setTimeout(() => r('TIMEOUT(8s)'), 8000))
    ]))
`, 90000));

process.exit(0);
