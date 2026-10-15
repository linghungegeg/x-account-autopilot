// 确认生图是否恢复（之前中转站 504），然后跑带图的发帖计划验证耗时。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 300000) => page.eval(expr, { timeoutMs });

console.log('=== 生图连通性 ===');
for (let i = 1; i <= 3; i += 1) {
  const t = Date.now();
  const r = await ev(`
    chrome.runtime.sendMessage({ type: 'AI_IMAGE', prompt: 'a minimal flat illustration of a clock, soft blue' })
      .then(x => JSON.stringify({ ok: x.ok, kb: Math.round(((x.dataUrl||'').length) * 0.75 / 1024), error: (x.error||'').slice(0, 70) }))
      .catch(e => 'ERR: ' + e.message)
  `, 240000);
  console.log(`  第 ${i} 次  ${Math.round((Date.now() - t) / 1000)}s  ${r}`);
  const parsed = JSON.parse(r);
  if (parsed.ok) break;
  await sleep(5000);
}

process.exit(0);
