// 看当前状态，必要时停机。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

const call = m => page.eval(`chrome.runtime.sendMessage(${JSON.stringify(m)}).then(r => JSON.stringify({ ok: r.ok })).catch(e => 'ERR: ' + e.message)`);

const state = JSON.parse(await page.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    dryRun: r.state.behavior.dryRun,
    current: r.state.current,
    pending: r.state.pendingCount,
    plan: { enabled: r.state.postPlan.enabled, mode: r.state.postPlan.mode, times: r.state.postPlan.scheduledTimes },
    items: r.state.postPlan.items.map(i => ({ status: i.status, text: i.text.slice(0, 40), href: i.statusHref })),
    postCountToday: r.state.postCountToday,
    logs: r.state.logs.slice(0, 8).map(l => l.tag + ' | ' + l.message.slice(0, 80))
  }))
`));

console.log(JSON.stringify(state, null, 2));

if (state.enabled) {
  console.log('\n⚠️ 总开关还开着，停机');
  console.log(await call({ type: 'SET_ENABLED', enabled: false }));
  console.log(await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } }));
  console.log(await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } }));
} else {
  console.log('\n总开关已关，安全');
}

process.exit(0);
