// 在扩展页面上下文里动态 import service worker，把加载失败的真实原因逼出来。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);

const logs = [];
page.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(`${msg.params.type}: ` + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Log.entryAdded') {
    logs.push(`LOG[${msg.params.entry.level}]: ${msg.params.entry.text}`);
  }
});
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Page.enable');
await sleep(3000);

console.log('页面已打开:', await page.eval('location.href'));

// 逐个 import 三个 lib，定位是哪一个挂
const targets = [
  'src/lib/guardrails.js',
  'src/lib/store.js',
  'src/lib/image.js',
  'src/background/service-worker.js'
];

for (const path of targets) {
  const result = await page.eval(`
    import(chrome.runtime.getURL(${JSON.stringify(path)}))
      .then(m => 'OK  导出: ' + Object.keys(m).join(', '))
      .catch(e => 'FAIL ' + (e && (e.message || e.toString())))
  `).catch(e => 'FAIL(外层) ' + e.message);
  console.log(`\n${path}\n  → ${result}`);
}

console.log('\n=== 页面控制台输出 ===');
if (logs.length) logs.slice(0, 25).forEach(l => console.log('  ' + l.slice(0, 400)));
else console.log('  （无）');

process.exit(0);
