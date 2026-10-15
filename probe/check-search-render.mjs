// 诊断：搜索页导航后到底多久才渲染出推文列表。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const cdp = await connect({ port: PORT });

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const pages = targets.filter(t => t.type === 'page' && t.url.includes('x.com'));
console.log(`x.com 标签页 ${pages.length} 个:`);
pages.forEach((p, i) => console.log(`  [${i}] ${p.url}`));

// 优先挑搜索页
const searchTarget = pages.find(p => p.url.includes('/search')) || pages[pages.length - 1];
const page = await cdp.attach(searchTarget);
await page.send('Page.enable');
console.log(`\n检查: ${page.target.url}`);

const READ = `(() => {
  const txt = (document.body.innerText || '').split('\\n').filter(Boolean).slice(0, 6).join(' | ');
  return {
    path: location.pathname + location.search,
    tweets: document.querySelectorAll('[data-testid="tweet"]').length,
    cells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
    spinner: !!document.querySelector('[role="progressbar"]'),
    head: txt.slice(0, 160)
  };
})()`;

console.log('\n=== 当前状态 ===');
console.log(JSON.stringify(await page.eval(READ), null, 2));

console.log('\n=== 重新导航到搜索页，观察列表渲染耗时 ===');
await page.send('Page.navigate', { url: 'https://x.com/search?q=AI&src=typed_query&f=live' });

for (let i = 1; i <= 10; i += 1) {
  await sleep(2000);
  const state = await page.eval(READ);
  console.log(`  ${String(i * 2).padStart(2)}s  推文=${state.tweets}  cell=${state.cells}  转圈=${state.spinner}`);
  if (state.tweets > 0) { console.log(`  ✅ 第 ${i * 2} 秒渲染出 ${state.tweets} 条推文`); break; }
}

console.log('\n=== 最终 ===');
console.log(JSON.stringify(await page.eval(READ), null, 2));

process.exit(0);
