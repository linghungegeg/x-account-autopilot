// 查清：工作标签页为什么加载超时？计划条目现在什么状态？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

const ev = (expr, timeoutMs = 60000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 60000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);

console.log('停机:', await call({ type: 'SET_ENABLED', enabled: false }));
console.log('回演练:', await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } }));
console.log('关计划:', await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } }));

console.log('\n=== 所有标签页 ===');
const tabs = JSON.parse(await ev(`chrome.tabs.query({}).then(l => JSON.stringify(l.map(t => ({ id: t.id, url: (t.url||'').slice(0,70), status: t.status, active: t.active }))))`));
tabs.forEach(t => console.log(`  [${t.id}]${t.active ? '★' : ' '} ${t.status}  ${t.url}`));

console.log('\n=== 后台状态 ===');
console.log(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    workerTabId: r.state.workerTabId,
    current: r.state.current,
    planItems: r.state.postPlan.items.map(i => ({ status: i.status, error: i.error, text: i.text.slice(0,40) })),
    postCountToday: r.state.postCountToday,
    statsByAction: r.state.stats.byAction,
    blockReason: r.state.blockReason,
    keywords: r.state.keywords,
    seenCount: Object.keys(r.state.seen || {}).length,
    logs: r.state.logs.slice(0, 10).map(l => new Date(l.at).toLocaleTimeString('zh-CN',{hour12:false}) + ' ' + l.tag + ' | ' + l.message.slice(0, 65))
  }, null, 2))
`));

process.exit(0);
