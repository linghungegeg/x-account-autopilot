// 验证评论语言：用指定关键词扫一轮，演练跑一条评论，只看生成内容的语言。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';
const KEYWORD = process.env.KEYWORD || 'rust programming';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

// 只回传需要看的字段，不要把整个 state 打出来
const call = (msg, timeoutMs = 180000) => page.eval(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)})
     .then(r => JSON.stringify({ ok: r.ok, error: r.error }))
     .catch(e => 'ERR: ' + e.message)`,
  { timeoutMs }
);

console.log(`=== 关键词：${KEYWORD} ===`);
await call({ type: 'SAVE_KEYWORDS', keywords: [KEYWORD] });
await call({ type: 'CLEAR_QUEUE' });
await call({ type: 'SAVE_BEHAVIOR', behavior: { dryRun: true, enabled: true } });

console.log('>>> 扫描入队');
await call({ type: 'SCAN_NOW' });

const sources = JSON.parse(await page.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' })
    .then(r => JSON.stringify(r.state.queue.filter(t => t.type === 'reply').slice(0, 3).map(t => ({
      author: t.payload.author, text: (t.payload.sourceText || '').replace(/\\n/g, ' ').slice(0, 70)
    }))))
`));
console.log('候选原帖:');
sources.forEach((s, i) => console.log(`  [${i + 1}] @${s.author}: ${s.text}`));

console.log('\n>>> 演练执行一条评论');
await call({ type: 'RUN_NOW' });
await sleep(2000);

const logs = JSON.parse(await page.eval(`
  chrome.runtime.sendMessage({ type: 'GET_LOGS', page: 1, pageSize: 30 })
    .then(r => JSON.stringify(r.entries.filter(e => e.tag === '发布').slice(0, 6).map(e => ({ level: e.level, msg: e.message }))))
`));

console.log('\n=== 发布类日志 ===');
logs.forEach(l => console.log(`  [${l.level}] ${l.msg.slice(0, 150)}`));

const generated = logs.find(l => l.msg.startsWith('演练内容：'));
console.log('\n=== 结论 ===');
if (generated) {
  const comment = generated.msg.replace('演练内容：', '');
  const cjk = (comment.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (comment.match(/[A-Za-z]/g) || []).length;
  console.log(`评论：${comment}`);
  console.log(`中文 ${cjk} / 拉丁 ${latin} → ${cjk > latin ? '✅ 中文' : '✅ 英文'}`);
} else {
  console.log('⚠️ 没找到生成的评论');
}

await call({ type: 'SET_ENABLED', enabled: false });
process.exit(0);
