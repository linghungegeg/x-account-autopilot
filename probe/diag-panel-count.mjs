// 面板的计数文本为什么读不到？
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;

const cdp = await connect({ port: PORT });
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTab = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
if (!xTab) { console.log('没有 x.com 标签页'); process.exit(1); }

const page = await cdp.attach(xTab);
await page.send('Page.enable');

// 抓内容脚本的报错
const errors = [];
page.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
});
await page.send('Runtime.enable');

await page.send('Page.reload');
await sleep(10000);

console.log('=== 面板 shadow DOM 结构 ===');
console.log(await page.eval(`(() => {
  const host = document.getElementById('x-helper-panel-host');
  if (!host) return JSON.stringify({ error: '面板不存在' });
  const sr = host.shadowRoot;
  if (!sr) return JSON.stringify({ error: '没有 shadowRoot' });
  const count = sr.querySelector('.count');
  return JSON.stringify({
    hasShadow: true,
    countExists: !!count,
    countClass: count?.className,
    countText: count?.textContent,
    headHTML: sr.querySelector('.head')?.outerHTML?.slice(0, 200),
    allClasses: [...sr.querySelectorAll('[class]')].map(e => e.className).filter(c => typeof c === 'string').slice(0, 12)
  }, null, 2);
})()`));

console.log('\n=== 内容脚本报错 ===');
console.log(errors.length ? errors.slice(0, 5).join('\n') : '  （无）');

// 手动触发一次面板渲染
console.log('\n=== 手动调 GET_PANEL 再渲染 ===');
console.log(await page.eval(`
  chrome.runtime.sendMessage({ type: 'GET_PANEL' })
    .then(r => JSON.stringify({
      ok: r.ok,
      panelKeys: r.panel ? Object.keys(r.panel) : null,
      pendingCount: r.panel?.pendingCount,
      total: r.panel?.total,
      maxPerDay: r.panel?.maxPerDay
    }, null, 2))
    .catch(e => 'ERR: ' + e.message)
`));

process.exit(0);
