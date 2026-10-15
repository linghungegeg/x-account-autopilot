// 验证假设：大 payload 走 chrome.tabs.sendMessage 会不会慢到不可用。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(3000);

const ev = (expr, timeoutMs = 300000) => page.eval(expr, { timeoutMs });

console.log('停机:', await ev(`chrome.runtime.sendMessage({type:'SET_ENABLED',enabled:false}).then(r=>JSON.stringify({ok:r.ok}))`));
await sleep(1500);

const tabId = await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);
console.log('工作标签页:', tabId);

// 测不同大小的消息往返耗时
for (const size of [1000, 100000, 500000, 1400000]) {
  const result = await ev(`
    (() => {
      const payload = 'x'.repeat(${size});
      const t0 = performance.now();
      return chrome.tabs.sendMessage(${tabId}, { type: 'X_PING', junk: payload })
        .then(r => JSON.stringify({ size: ${size}, ms: Math.round(performance.now() - t0), ok: !!r?.ok }))
        .catch(e => JSON.stringify({ size: ${size}, ms: Math.round(performance.now() - t0), error: e.message }));
    })()
  `, 120000).catch(e => `size=${size} 外层超时: ${e.message}`);
  console.log('  ' + result);
}

// 也测一下扩展内部消息
console.log('\n=== 扩展内部 sendMessage ===');
for (const size of [100000, 1400000]) {
  const result = await ev(`
    (() => {
      const payload = 'x'.repeat(${size});
      const t0 = performance.now();
      return chrome.runtime.sendMessage({ type: 'AI_CHAT', messages: [{ role: 'user', content: payload }], options: { baseUrl: '', apiKey: '' } })
        .then(r => JSON.stringify({ size: ${size}, ms: Math.round(performance.now() - t0), ok: r.ok, error: (r.error || '').slice(0, 60) }))
        .catch(e => JSON.stringify({ size: ${size}, ms: Math.round(performance.now() - t0), error: e.message }));
    })()
  `, 120000).catch(e => `size=${size} 外层超时: ${e.message}`);
  console.log('  ' + result);
}

process.exit(0);
