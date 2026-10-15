// 收尾：停机 + 恢复默认 + 清理测试残留。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 120000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 120000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);

console.log('停机:', await call({ type: 'SET_ENABLED', enabled: false }));
console.log('回演练:', await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } }));
console.log('关计划:', await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } }));
console.log('清队列:', await call({ type: 'CLEAR_QUEUE' }));
console.log('清冷却:', await call({ type: 'CLEAR_COOLDOWN' }));

// 清掉测试生成的计划条目
const ids = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(r.state.postPlan.items.map(i => i.id)))
`));
for (const id of ids) await call({ type: 'DELETE_POST_ITEM', id });
console.log(`清掉 ${ids.length} 条计划条目`);

// 恢复默认行为参数
console.log('恢复默认:', await call({ type: 'RESET_BEHAVIOR' }));
console.log('恢复关键词:', await call({ type: 'SAVE_KEYWORDS', keywords: ['AI 工具'] }));

console.log('\n=== 最终状态 ===');
console.log(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    dryRun: r.state.behavior.dryRun,
    preset: r.state.presetLabel,
    humanizePause: r.state.behavior.humanizePauseMinSec + '-' + r.state.behavior.humanizePauseMaxSec + 's',
    humanizeScroll: r.state.behavior.humanizeScrollMin + '-' + r.state.behavior.humanizeScrollMax,
    keywords: r.state.keywords,
    pending: r.state.pendingCount,
    planEnabled: r.state.postPlan.enabled,
    planItems: r.state.postPlan.items.length,
    seen: Object.keys(r.state.seen || {}).length,
    blockReason: r.state.blockReason
  }, null, 2))
`));

process.exit(0);
