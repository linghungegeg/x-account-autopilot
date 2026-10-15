// 点开 chrome://extensions 的「错误」按钮，把错误内容读出来。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;
const EXT_ID = process.env.EXT_ID || 'beoeccdkmifoakblkibgmedccfknhfbi';

const cdp = await connect({ port: PORT });

// 先记下当前有哪些页面，点完之后看新开了什么
const before = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()))
  .filter(t => t.type === 'page').map(t => t.id);

const page = await cdp.newPage('chrome://extensions/');
await page.send('Page.enable');
await sleep(4000);

const clicked = await page.eval(`(() => {
  const manager = document.querySelector('extensions-manager');
  const list = manager?.shadowRoot?.querySelector('extensions-item-list');
  const items = [...(list?.shadowRoot?.querySelectorAll('extensions-item') || [])];
  const item = items.find(i => i.id === ${JSON.stringify(EXT_ID)});
  const btn = item?.shadowRoot?.querySelector('#errors-button');
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
})()`);
console.log('点击错误按钮:', clicked);
await sleep(3000);

// 情况 A：在新标签页里打开错误详情
const after = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()))
  .filter(t => t.type === 'page');
const fresh = after.filter(t => !before.includes(t.id));
console.log('\n新开的页面:');
fresh.forEach(t => console.log(`  ${t.url.slice(0, 100)}`));

for (const t of fresh) {
  const p = await cdp.attach(t);
  await p.send('Page.enable');
  await sleep(1500);
  const text = await p.eval(`(document.body?.innerText || '').slice(0, 3000)`);
  console.log(`\n--- 内容 ${t.url.slice(0, 80)} ---`);
  console.log(text);
}

// 情况 B：错误列表渲染在 extensions 页面自己的 shadow DOM 里
const inline = await page.eval(`(() => {
  const manager = document.querySelector('extensions-manager');
  const roots = [manager?.shadowRoot, document];
  const found = [];
  for (const root of roots) {
    for (const el of (root?.querySelectorAll('*') || [])) {
      if (el.shadowRoot) {
        const t = el.shadowRoot.textContent || '';
        if (/error|错误|Uncaught|TypeError|ReferenceError/i.test(t)) {
          found.push(el.tagName + ': ' + t.replace(/\\s+/g, ' ').slice(0, 1200));
        }
      }
    }
  }
  return JSON.stringify(found.slice(0, 6), null, 2);
})()`);
console.log('\n=== 页面内联错误 ===');
console.log(inline);
process.exit(0);
