// 复现并验证 popup 的「运行中」分支（曾经在这里抛 mode is not defined）。
//
// 触发条件：已开启总开关 + 无风控 + 无 blockReason + 当前没有任务在跑。
// 这个分支一旦抛异常，renderStatus 后面的 renderStats/renderQueue/renderLogs 都不会执行，
// 所以「状态栏有没有字」和「四宫格有没有数」就是最直接的成功信号。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });

// ---------------------------------------------------------------- 1. 重载扩展
console.log('>>> 1. 重载扩展（同时会清掉旧的错误记录）');
const opts = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await opts.send('Page.enable');
await sleep(2500);
await opts.eval(`(() => { chrome.runtime.reload(); return true; })()`).catch(() => {});
await sleep(6000);

// ---------------------------------------------------------------- 2. 造出「已开启 + 空闲」
const opts2 = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await opts2.send('Page.enable');
await sleep(3000);
const ev = (expr, timeoutMs = 60000) => opts2.eval(expr, { timeoutMs });
const call = (msg) => ev(`chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`);

console.log('\n>>> 2. 清空队列与关键词，打开总开关（保持演练）');
console.log('  CLEAR_QUEUE      ', await call({ type: 'CLEAR_QUEUE' }));
console.log('  SAVE_KEYWORDS [] ', await call({ type: 'SAVE_KEYWORDS', keywords: [] }));
console.log('  CLEAR_COOLDOWN   ', await call({ type: 'CLEAR_COOLDOWN' }));
console.log('  dryRun = true    ', await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } }));
console.log('  SET_ENABLED true ', await call({ type: 'SET_ENABLED', enabled: true }));

// 等调度器这一轮跑完，落到空闲
await sleep(6000);
const before = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    enabled: r.state.behavior.enabled,
    dryRun: r.state.behavior.dryRun,
    challenge: r.state.challenge || null,
    blockReason: r.state.blockReason || '',
    current: r.state.current || null,
    presetLabel: r.state.presetLabel,
    nextRunInMs: r.state.nextRunInMs
  }))
`));
console.log('\n打开弹窗前的后台状态:');
console.log(JSON.stringify(before, null, 2));

const willHitBranch = before.enabled && !before.challenge && !before.blockReason && !before.current;
console.log(willHitBranch
  ? '  ✅ 状态满足「运行中」分支，正好覆盖出过 bug 的那条路径'
  : '  ⚠️ 状态不满足「运行中」分支，本次没覆盖到目标路径');

// ---------------------------------------------------------------- 3. 打开弹窗
console.log('\n>>> 3. 打开弹窗并捕获异常');
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
const exceptions = [];
popup.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params?.exceptionDetails;
    exceptions.push(d?.exception?.description || d?.text || JSON.stringify(d));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    exceptions.push('[console.error] ' + (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
  }
});
await popup.send('Page.enable');
await sleep(6000);

const rendered = JSON.parse(await popup.eval(`
  (() => {
    const t = id => document.querySelector(id)?.textContent ?? null;
    return JSON.stringify({
      status: t('#status'),
      statusClass: document.querySelector('#status')?.className ?? null,
      enabled: document.querySelector('#enabled')?.checked ?? null,
      dryRun: document.querySelector('#dryRun')?.checked ?? null,
      statBrowse: t('#statBrowse'),
      statLike: t('#statLike'),
      statReply: t('#statReply'),
      statFollow: t('#statFollow'),
      acctHandle: t('#acctHandle'),
      queueCount: document.querySelectorAll('#queueList > *').length,
      logCount: document.querySelectorAll('#logList > *').length
    });
  })()
`));

console.log('\n弹窗渲染结果:');
console.log(JSON.stringify(rendered, null, 2));
console.log('\n捕获到的异常:', exceptions.length ? JSON.stringify(exceptions, null, 2) : '（无）');

// ---------------------------------------------------------------- 4. 收尾
console.log('\n>>> 4. 关掉总开关');
console.log('  SET_ENABLED false', await call({ type: 'SET_ENABLED', enabled: false }));

const ok = rendered.status && rendered.status.includes('运行中') && !exceptions.length;
console.log(ok
  ? '\n✅ 修复生效：运行中分支正常渲染，无 ReferenceError'
  : '\n❌ 仍有问题');
process.exit(0);
