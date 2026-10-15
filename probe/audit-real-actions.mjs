// 盘点并清理：测试期间关掉演练模式后，真实执行了哪些动作。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const ev = (expr, timeoutMs = 120000) => ext.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 120000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);

// 先确保停下来
console.log('>>> 先停机');
console.log(await call({ type: 'SET_ENABLED', enabled: false }));
console.log(await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true } }));
console.log(await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } }));

// 盘点真实动作（不带"演练"字样的成功记录）
const state = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    queue: r.state.queue.map(t => ({ type: t.type, status: t.status, author: t.payload?.author, text: (t.payload?.text || '').slice(0, 40) })),
    logs: r.state.logs.slice(0, 40).map(l => ({ level: l.level, tag: l.tag, action: l.action, author: l.author, href: l.statusHref, msg: l.message }))
  }))
`));

console.log('\n=== 队列 ===');
state.queue.forEach(t => console.log(`  ${t.type} ${t.status} ${t.author || t.text || ''}`));

console.log('\n=== 真实成功的动作（不带"演练"字样）===');
const real = state.logs.filter(l => l.level === 'success' && !l.msg.includes('演练'));
if (!real.length) console.log('  （无）');
real.forEach(l => console.log(`  [${l.tag}] ${l.msg}  ${l.href || ''}`));

console.log('\n=== 最近失败 ===');
state.logs.filter(l => l.level === 'error').slice(0, 6).forEach(l => console.log(`  ${l.msg.slice(0, 100)}`));

process.exit(0);
