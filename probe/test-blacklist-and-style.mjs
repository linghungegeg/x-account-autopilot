// 测黑名单过滤 + 评论风格是否真的生效。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const KEYWORD = process.env.KEYWORD || '独立开发者';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 200000) => page.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 200000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);

// ---------------------------------------------------------------- 1. 黑名单
console.log('=== 1. 黑名单过滤 ===');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_COOLDOWN' });
await call({ type: 'CLEAR_SEEN' });
await call({ type: 'SAVE_KEYWORDS', keywords: [KEYWORD] });

// 先不带黑名单扫一次，看有哪些作者
await call({ type: 'SAVE_BEHAVIOR', behavior: { blacklistUsers: [], blacklistWords: [] } });
await call({ type: 'SCAN_NOW' });
const first = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    authors: [...new Set(r.state.queue.filter(t => t.payload?.author).map(t => t.payload.author))],
    count: r.state.queue.length
  }))
`));
console.log('无黑名单时入队的作者:', first.authors, `共 ${first.count} 个任务`);

if (!first.authors.length) { console.log('❌ 没扫到结果，无法测黑名单'); process.exit(1); }

// 把第一个作者加进黑名单，再扫一次
const blockedUser = first.authors[0];
console.log(`\n>>> 把 @${blockedUser} 加进黑名单，再扫一次`);
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_SEEN' });
await call({ type: 'SAVE_BEHAVIOR', behavior: { blacklistUsers: [blockedUser], blacklistWords: [] } });
await call({ type: 'SCAN_NOW' });

const second = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    authors: [...new Set(r.state.queue.filter(t => t.payload?.author).map(t => t.payload.author))],
    count: r.state.queue.length,
    skipLogs: r.state.logs.filter(l => l.message.startsWith('跳过')).map(l => l.message).slice(0, 3)
  }))
`));
console.log('加黑名单后入队的作者:', second.authors, `共 ${second.count} 个任务`);
console.log('跳过日志:', second.skipLogs);

const filtered = !second.authors.includes(blockedUser);
console.log(filtered ? `✅ @${blockedUser} 被正确过滤掉了` : `❌ @${blockedUser} 仍在队列里`);

// ---------------------------------------------------------------- 2. 评论风格
console.log('\n=== 2. 评论风格 ===');
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_SEEN' });
await call({ type: 'SAVE_BEHAVIOR', behavior: {
  blacklistUsers: [], blacklistWords: [],
  commentStyles: ['专业补充'],
  commentLanguage: 'zh',
  dryRun: true
} });
console.log('风格设为: 专业补充 / 语言强制中文');

await call({ type: 'SCAN_NOW' });
await call({ type: 'SET_ENABLED', enabled: true });
await call({ type: 'RUN_NOW' });
await sleep(3000);

const comment = JSON.parse(await ev(`
  chrome.runtime.sendMessage({ type: 'GET_LOGS', page: 1, pageSize: 20 }).then(r => JSON.stringify(
    r.entries.filter(e => e.message.startsWith('演练内容')).slice(0, 2).map(e => e.message.replace('演练内容：', ''))
  ))
`));
console.log('生成的评论:');
comment.forEach((c, i) => console.log(`  [${i + 1}] ${c}`));

// ---------------------------------------------------------------- 收尾
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'CLEAR_SEEN' });
await call({ type: 'SAVE_BEHAVIOR', behavior: {
  blacklistUsers: [], blacklistWords: [],
  commentStyles: ['真诚互动', '提问式', '简短共鸣'],
  commentLanguage: 'match'
} });

process.exit(0);
