// 查工作标签页为什么加载超时。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });

console.log('=== x.com 标签页状态 ===');
console.log(await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(tabs => JSON.stringify(
    tabs.map(t => ({ id: t.id, url: (t.url || '').slice(0, 75), status: t.status, active: t.active, discarded: t.discarded })), null, 2))
`));

console.log('\n=== 后台记录的 workerTabId ===');
console.log(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    workerTabId: r.state.workerTabId,
    dedicatedTab: r.state.behavior.dedicatedTab,
    activateTab: r.state.behavior.activateTab,
    logs: r.state.logs.slice(0, 6).map(l => l.tag + ' | ' + l.message.slice(0, 70))
  }, null, 2))
`));

console.log('\n=== 逐个 ping 每个 x.com 标签页 ===');
const tabs = JSON.parse(await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(t => JSON.stringify(t.map(x => x.id)))`));
for (const id of tabs) {
  const r = await ev(`
    Promise.race([
      chrome.tabs.sendMessage(${id}, { type: 'X_PING' }).then(x => 'OK ' + x.url).catch(e => 'ERR: ' + e.message),
      new Promise(r => setTimeout(() => r('TIMEOUT(6s)'), 6000))
    ])
  `, 30000);
  console.log(`  [${id}] ${r}`);
}

console.log('\n=== 手动试一次导航到搜索页 ===');
const target = tabs[0];
if (target) {
  console.log('update:', await ev(`chrome.tabs.update(${target}, { url: 'https://x.com/search?q=test&f=live' }).then(t => JSON.stringify({ id: t.id, status: t.status })).catch(e => 'ERR: ' + e.message)`));
  for (let i = 1; i <= 6; i += 1) {
    await sleep(3000);
    const s = await ev(`chrome.tabs.get(${target}).then(t => JSON.stringify({ url: (t.url||'').slice(0,60), status: t.status })).catch(e => 'ERR')`);
    console.log(`  ${i * 3}s ${s}`);
  }
}

process.exit(0);
