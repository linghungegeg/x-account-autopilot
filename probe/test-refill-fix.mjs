// 实测队列修复：故意把队列塞满已完成任务，看还能不能补队列。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3500);

const ev = (expr, timeoutMs = 200000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 200000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);
const state = async () => JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    queueTotal: r.state.queue.length,
    queuePending: r.state.queue.filter(t => t.status === 'pending').length,
    queueDone: r.state.queue.filter(t => t.status === 'done' || t.status === 'failed').length,
    queueLimit: r.state.behavior.queueLimit,
    nextRunAt: r.state.nextRunAt,
    consecutiveFailures: r.state.consecutiveFailures,
    keywords: r.state.keywords,
    blockReason: r.state.blockReason,
    logs: r.state.logs.slice(0, 3).map(l => l.tag + ' | ' + l.message.slice(0, 60))
  }))
`));

console.log('=== 准备 ===');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_COOLDOWN' });
await call({ type: 'CLEAR_SEEN' });
await call({ type: 'SAVE_KEYWORDS', keywords: ['AI 工具'] });
// 把队列上限设小，方便制造"队列满"的场景
await call({ type: 'SAVE_BEHAVIOR', behavior: { queueLimit: 5, dryRun: true } });

console.log('初始:', await state());

// 关键测试：手工塞满已完成任务，超过 queueLimit
console.log('\n=== 塞入 12 条已完成任务（超过 queueLimit=5）===');
console.log(await ev(`
  chrome.storage.local.get('xState').then(async data => {
    const s = data.xState || {};
    const fake = Array.from({ length: 12 }, (_, i) => ({
      id: 'fake-' + i, type: 'like', payload: {}, status: i % 2 ? 'done' : 'failed',
      attempts: 1, createdAt: Date.now() - 100000 + i, finishedAt: Date.now() - 90000 + i, result: 'ok'
    }));
    s.queue = [...fake];
    await chrome.storage.local.set({ xState: s });
    return JSON.stringify({ seeded: 12 });
  })
`));
await sleep(1000);
console.log('塞入后:', await state());

console.log('\n=== 打开总开关，看会不会补队列 ===');
await call({ type: 'SET_ENABLED', enabled: true });
let maxPending = 0;
let sawEnqueue = false;
let grew = false;
for (let i = 1; i <= 40; i += 1) {
  await sleep(2000);
  const s = await state();
  maxPending = Math.max(maxPending, s.queuePending);
  if (s.queueTotal > 12) grew = true;
  if (s.logs.some(l => l.includes('入队'))) sawEnqueue = true;
  if (i % 3 === 0 || s.queuePending > 0) {
    console.log(`  ${i * 2}s  总${s.queueTotal} 待办${s.queuePending} 完成${s.queueDone} 连败${s.consecutiveFailures} 下次${s.nextRunAt ? Math.round((s.nextRunAt - Date.now()) / 1000) + 's' : '-'}  ${s.logs[0] || ''}`);
  }
  if (sawEnqueue && grew) break;
}

const final = await state();
console.log('\n=== 结果 ===');
console.log(JSON.stringify({ maxPending, grew, sawEnqueue, queueTotal: final.queueTotal, queueLimit: final.queueLimit }, null, 2));
console.log(grew || sawEnqueue
  ? '\n✅ 修复生效：已完成任务（12 条）远超 queueLimit=5，补队列仍然正常入队'
  : '\n❌ 仍然不补队列');

await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'CLEAR_QUEUE' });
process.exit(0);
