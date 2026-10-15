// 把 X 登录页打开并置前，方便用户登录。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9224;

const cdp = await connect({ port: PORT });
const page = await cdp.newPage('https://x.com/home');
await page.send('Page.enable');
await sleep(2000);

// 关掉多余的 onboarding 标签页，只留一个
const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xPages = list.filter(t => t.type === 'page' && t.url.includes('x.com'));
console.log(`当前 x.com 页面 ${xPages.length} 个`);
for (const p of xPages.slice(1)) {
  await fetch(`http://127.0.0.1:${PORT}/json/close/${p.id}`, { method: 'PUT' }).catch(() => {});
}

console.log('已打开 https://x.com/home —— 请在这个 Chrome 窗口里登录 X');
process.exit(0);
