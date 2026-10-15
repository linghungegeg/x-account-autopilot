// 打开 x.com 并验证扩展可用。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3500);

const ev = (expr, timeoutMs = 120000) => page.eval(expr, { timeoutMs });

console.log('后台:', await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' })
    .then(r => JSON.stringify({ ok: r.ok, version: chrome.runtime.getManifest().version, preset: r.state.presetLabel, keywords: r.state.keywords, queue: r.state.queue.length }))
    .catch(e => 'ERR: ' + e.message)
`));

console.log('\n打开 x.com…');
console.log(await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(tabs => {
    if (tabs.length) return JSON.stringify({ existing: tabs.length });
    return chrome.tabs.create({ url: 'https://x.com/home', active: false }).then(t => JSON.stringify({ created: t.id }));
  })
`));
await sleep(16000);

console.log('\n内容脚本:', await ev(`
  chrome.tabs.query({ url: ['https://x.com/*'] })
    .then(tabs => tabs.length
      ? chrome.tabs.sendMessage(tabs[0].id, { type: 'X_PING' }).then(r => JSON.stringify({ ok: r.ok, url: r.url, account: r.account?.handle })).catch(e => 'ERR: ' + e.message)
      : 'no-tab')
`));

process.exit(0);
