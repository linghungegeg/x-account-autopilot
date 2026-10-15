// 验证 toast（第二次尝试）：用推文菜单里的「不感兴趣」触发。
// 这是 X 最标准的 toast 场景，而且 toast 自带 Undo，测完立刻撤销。
import { writeFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const OUT = 'probe/result-live-toast.json';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage('https://x.com/home');
await page.send('Page.enable');
await sleep(6000);

console.log('推文数:', await page.eval(`document.querySelectorAll('[data-testid="tweet"]').length`));

// 打开第一条推文的更多菜单
await page.eval(`(() => {
  const a = document.querySelector('[data-testid="tweet"]');
  const c = a.querySelector('[data-testid="caret"]');
  if (c) c.click();
  return !!c;
})()`);
await sleep(1500);

const items = await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].map(i => (i.innerText || '').trim())`);
console.log('菜单项:', JSON.stringify(items));

const idx = items.findIndex(t => /not interested|不感兴趣/i.test(t));
if (idx < 0) { console.log('❌ 菜单里没有「不感兴趣」'); process.exit(1); }

console.log(`\n>>> 点击「${items[idx]}」`);
await page.eval(`(() => {
  [...document.querySelectorAll('[role="menuitem"]')][${idx}].click();
  return true;
})()`);

// 盯 toast
let toast = null;
for (let i = 0; i < 24; i++) {
  await sleep(250);
  const t = await page.eval(`(() => {
    const el = document.querySelector('[data-testid="toast"]');
    if (!el) return null;
    return {
      text: (el.innerText || '').trim(),
      html: el.outerHTML.slice(0, 420),
      buttons: [...el.querySelectorAll('button,[role="button"]')].map(b => (b.innerText || '').trim()).filter(Boolean)
    };
  })()`);
  if (t) { toast = { ...t, appearedAfterMs: (i + 1) * 250 }; console.log(`  ✅ ${(i + 1) * 250}ms 出现: ${JSON.stringify(t.text)}`); break; }
}

if (toast) {
  console.log('  toast 里的按钮:', JSON.stringify(toast.buttons));
  console.log('  HTML:', toast.html.slice(0, 300));

  // 撤销
  const undone = await page.eval(`(() => {
    const el = document.querySelector('[data-testid="toast"]');
    if (!el) return false;
    const btn = [...el.querySelectorAll('button,[role="button"]')]
      .find(b => /undo|撤销/i.test(b.innerText || ''));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  console.log('\n>>> 撤销:', undone ? '已点击 Undo' : '没找到 Undo 按钮');
  await sleep(1500);
  const after = await page.eval(`(() => {
    const el = document.querySelector('[data-testid="toast"]');
    return el ? (el.innerText || '').trim() : null;
  })()`);
  console.log('撤销后的 toast:', JSON.stringify(after));
} else {
  console.log('❌ 没捕捉到 toast');
}

console.log('\n=== 结论 ===');
console.log(toast ? `✅ [data-testid="toast"] 存在，${toast.appearedAfterMs}ms 内出现` : '❌ 仍未确认');

writeFileSync(OUT, JSON.stringify({ items, clicked: items[idx], toast }, null, 2));
console.log(`完整结果: ${OUT}`);

await fetch(`http://127.0.0.1:${PORT}/json/close/${page.target.id}`, { method: 'PUT' }).catch(() => {});
await sleep(500);
const rest = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('剩余页面:', rest.filter(t => t.type === 'page').map(t => t.url).join(', '));
process.exit(0);
