// 直接测 X_POST 各阶段耗时，定位慢在哪。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const ext = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await ext.send('Page.enable');
await sleep(2500);

const ev = (expr, timeoutMs = 300000) => ext.eval(expr, { timeoutMs });
const call = (msg, timeoutMs = 300000) => ev(
  `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => JSON.stringify({ ok: r.ok, error: r.error })).catch(e => 'ERR: ' + e.message)`,
  timeoutMs
);

console.log('>>> 先停机，别让调度器占着标签页');
await call({ type: 'SET_ENABLED', enabled: false });
await call({ type: 'SAVE_POST_PLAN', plan: { enabled: false } });
await sleep(2000);

const tabId = await ev(`chrome.tabs.query({ url: ['https://x.com/*'] }).then(l => l[0]?.id ?? null)`);
console.log('工作标签页:', tabId);

const sendPost = async (label, humanize) => {
  await ev(`chrome.tabs.update(${tabId}, { url: 'https://x.com/home' })`);
  await sleep(13000);

  const before = JSON.parse(await ev(`
    chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => ({ scrollY: Math.round(window.scrollY), editors: document.querySelectorAll('[data-testid="tweetTextarea_0"]').length }) })
      .then(r => JSON.stringify(r[0]?.result))
  `));
  console.log(`\n>>> ${label}  起始 scrollY=${before.scrollY} 编辑器=${before.editors}`);

  const started = Date.now();
  const result = await ev(`
    chrome.tabs.sendMessage(${tabId}, {
      type: 'X_POST',
      text: 'timing probe',
      mediaDataUrl: '',
      dryRun: true,
      humanize: ${JSON.stringify(humanize)}
    }).then(r => JSON.stringify(r)).catch(e => 'ERR: ' + e.message)
  `);
  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`  耗时 ${elapsed}s  → ${result}`);

  const after = JSON.parse(await ev(`
    chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => ({ scrollY: Math.round(window.scrollY), text: (document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '').trim().slice(0, 30) }) })
      .then(r => JSON.stringify(r[0]?.result))
  `));
  console.log(`  结束 scrollY=${after.scrollY} 编辑器内容="${after.text}"`);

  // 清掉测试内容
  await ev(`chrome.tabs.sendMessage(${tabId}, { type: 'X_CLEAR_DRAFT' }).catch(() => {})`);
  return elapsed;
};

const t1 = await sendPost('A. 关掉拟人化', { humanize: false });
const t2 = await sendPost('B. 开启拟人化（默认 2-6 次滚动、2-8 秒停留）', {
  humanize: true,
  humanizeScrollMin: 2,
  humanizeScrollMax: 6,
  humanizePauseMinSec: 2,
  humanizePauseMaxSec: 8
});

console.log('\n=== 结论 ===');
console.log(`  关拟人化：${t1}s`);
console.log(`  开拟人化：${t2}s`);
console.log(`  拟人化代价：${t2 - t1}s`);

process.exit(0);
