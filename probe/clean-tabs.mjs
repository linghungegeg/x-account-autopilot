// 排干扰：列出所有标签页，关掉多余的 x.com 标签页，只留一个工作页。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const tabs = await ext.eval(`
  chrome.tabs.query({}).then(list => JSON.stringify(list.map(t => ({ id: t.id, url: (t.url || '').slice(0, 70), active: t.active }))))
`);
console.log('=== 所有标签页 ===');
JSON.parse(tabs).forEach(t => console.log(`  [${t.id}] ${t.active ? '★' : ' '} ${t.url}`));

// 关掉除第一个 x.com 之外的所有 x.com 标签页
const closed = await ext.eval(`
  chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }).then(async list => {
    if (list.length <= 1) return '只有一个 x.com 标签页，无需清理';
    const keep = list[0].id;
    for (const t of list.slice(1)) await chrome.tabs.remove(t.id);
    return '保留了 ' + keep + '，关掉了 ' + (list.length - 1) + ' 个';
  })
`);
console.log('\n清理:', closed);

// 关掉多余的扩展页和 chrome:// 页
const closedOther = await ext.eval(`
  chrome.tabs.query({}).then(async list => {
    const junk = list.filter(t => t.url?.startsWith('chrome://extensions') || t.url?.startsWith('chrome-extension://'));
    const keep = junk[0]?.id;
    let n = 0;
    for (const t of junk) { if (t.id !== keep && t.id !== undefined) { await chrome.tabs.remove(t.id).catch(() => {}); n += 1; } }
    return '关掉 ' + n + ' 个杂项页';
  })
`);
console.log(closedOther);

await sleep(2000);
const after = await ext.eval(`
  chrome.tabs.query({}).then(list => JSON.stringify(list.map(t => ({ id: t.id, url: (t.url || '').slice(0, 70) }))))
`);
console.log('\n=== 清理后 ===');
JSON.parse(after).forEach(t => console.log(`  [${t.id}] ${t.url}`));

// 确认内容脚本在唯一的工作标签页上活着
const ping = await ext.eval(`
  chrome.tabs.query({ url: ['https://x.com/*'] }).then(async list => {
    if (!list.length) return '没有 x.com 标签页';
    try {
      const r = await chrome.tabs.sendMessage(list[0].id, { type: 'X_PING' });
      return 'tab ' + list[0].id + ' → ' + JSON.stringify({ ok: r.ok, url: r.url });
    } catch (e) { return 'tab ' + list[0].id + ' → ERR: ' + e.message; }
  })
`);
console.log('\n内容脚本:', ping);

process.exit(0);
