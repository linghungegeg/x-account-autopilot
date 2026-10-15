// 测「先审后发」：任务应停在待审核、文案预先生成好、点通过后才执行。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const KEYWORD = process.env.KEYWORD || 'rust programming';

const cdp = await connect({ port: PORT });
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 200000) => popup.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 200000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);

console.log('=== 准备：清队列 + 清冷却 + 开 review 模式 + 开演练 ===');
console.log(await call({ type: 'CLEAR_QUEUE' }));
console.log(await call({ type: 'CLEAR_COOLDOWN' }));
console.log(await call({ type: 'SAVE_KEYWORDS', keywords: [KEYWORD] }));
console.log(await call({ type: 'SAVE_BEHAVIOR', behavior: { mode: 'review', dryRun: true, enabled: true } }));

// 让调度器停一下，避免它自己把任务跑掉
await call({ type: 'SET_ENABLED', enabled: false });

console.log('\n>>> 扫描入队（review 模式下评论应该停在待审核）');
console.log(await call({ type: 'SCAN_NOW' }, 200000));

const state = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    mode: r.state.behavior.mode,
    pending: r.state.pendingCount,
    review: r.state.reviewCount,
    reviewItems: r.state.queue.filter(t => t.status === 'awaiting_review').map(t => ({
      id: t.id, type: t.type, author: t.payload.author,
      comment: t.payload.comment || '(空)'
    })).slice(0, 4),
    otherItems: r.state.queue.filter(t => t.status === 'pending').map(t => t.type).slice(0, 8)
  }, null, 2))
`));
console.log(state);

console.log('\n=== 弹窗里的待审核列表 ===');
const reviewUi = JSON.parse(await ev(`(() => ({
  countLabel: document.querySelector('#reviewCount')?.textContent,
  items: [...document.querySelectorAll('#reviewList .item')].map(i => i.textContent.trim().slice(0, 90)).slice(0, 3)
}))()`));
console.log(JSON.stringify(reviewUi, null, 2));

// ---------------------------------------------------------------- 通过一条
const target = state.reviewItems[0];
if (!target) {
  console.log('\n❌ 没有待审核任务，review 模式可能没生效');
} else {
  console.log(`\n>>> 点「通过」: ${target.type} @${target.author}`);
  console.log('   预生成文案:', target.comment);

  const approved = await ev(`
    (() => {
      const btn = [...document.querySelectorAll('#reviewList .item')]
        .find(i => i.textContent.includes(${JSON.stringify(target.author)}))
        ?.querySelector('.item-actions button');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()
  `);
  console.log('   点击结果:', approved);
  await sleep(3000);

  const after = JSON.parse(await ev(`
    chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
      pending: r.state.pendingCount,
      review: r.state.reviewCount,
      approvedTask: r.state.queue.find(t => t.id === ${JSON.stringify(target.id)})?.status
    }))
  `));
  console.log('   通过后:', JSON.stringify(after));

  // 让调度器跑一次，验证它会被执行
  console.log('\n>>> 打开总开关，验证审核通过的任务会执行');
  await call({ type: 'SET_ENABLED', enabled: true });
  for (let i = 0; i < 12; i += 1) {
    await sleep(8000);
    const s = JSON.parse(await ev(`
      chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
        current: r.state.current?.stage || null,
        status: r.state.queue.find(t => t.id === ${JSON.stringify(target.id)})?.status,
        logs: r.state.logs.slice(0, 2).map(l => l.tag + ' | ' + l.message.slice(0, 70))
      }))
    `));
    console.log(`   ${i * 8}s  ${s.current || '空闲'}  该任务=${s.status}  ${s.logs[0] || ''}`);
    if (s.status === 'done' || s.status === 'failed') break;
  }

  const final = JSON.parse(await ev(`
    chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
      status: r.state.queue.find(t => t.id === ${JSON.stringify(target.id)})?.status,
      result: r.state.queue.find(t => t.id === ${JSON.stringify(target.id)})?.result,
      logs: r.state.logs.slice(0, 5).map(l => l.tag + ' | ' + l.level + ' | ' + l.message.slice(0, 80))
    }))
  `));
  console.log('\n=== 结果 ===');
  console.log(JSON.stringify(final, null, 2));
}

console.log('\n>>> 收尾');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'SAVE_BEHAVIOR', behavior: { mode: 'auto', dryRun: true } });

process.exit(0);
