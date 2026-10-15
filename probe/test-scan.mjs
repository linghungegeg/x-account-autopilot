// 短测：点「扫描补队列」，验证搜索页异步渲染的修复是否生效。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(3000);

const read = `(() => ({
  status: document.querySelector('#status')?.textContent,
  pending: document.querySelector('#pendingCount')?.textContent,
  logs: [...document.querySelectorAll('#logs .log')].map(l => l.textContent.trim()).slice(0, 4),
  queue: [...document.querySelectorAll('#queueList .item')].map(i => i.textContent.trim().slice(0, 80)).slice(0, 4)
}))()`;

console.log('=== 点击前 ===');
console.log(JSON.stringify(await popup.eval(read), null, 2));

console.log('\n>>> 点「扫描补队列」');
await popup.eval(`document.querySelector('#scanNow').click()`);

for (let i = 1; i <= 8; i += 1) {
  await sleep(3000);
  const s = await popup.eval(read);
  console.log(`  ${i * 3}s  待执行=${s.pending}  最新日志: ${(s.logs[0] || '').slice(0, 90)}`);
  if (Number(s.pending) > 0) { console.log('  ✅ 队列有内容了'); break; }
}

console.log('\n=== 结果 ===');
console.log(JSON.stringify(await popup.eval(read), null, 2));

process.exit(0);
