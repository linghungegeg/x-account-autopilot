// 检查浏览器里实际加载的 SW 是哪个版本。
import { connect, sleep } from './cdp.js';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

const loaded = await page.eval(`
  fetch(chrome.runtime.getURL('src/background/service-worker.js'))
    .then(r => r.text())
    .then(t => JSON.stringify({
      length: t.length,
      hasActionCall: t.includes('ACTION_CALL'),
      has240000: t.includes('240000'),
      hasWithTimeout: t.includes('withTimeout'),
      hasWatchdog: t.includes('async function watchdog')
    }))
    .catch(e => 'ERR: ' + e.message)
`);
console.log('浏览器里加载的:', loaded);

const disk = readFileSync('src/background/service-worker.js', 'utf8');
console.log('磁盘上的:', JSON.stringify({
  length: disk.length,
  hasActionCall: disk.includes('ACTION_CALL'),
  has240000: disk.includes('240000'),
  hasWithTimeout: disk.includes('withTimeout'),
  hasWatchdog: disk.includes('async function watchdog')
}));

process.exit(0);
