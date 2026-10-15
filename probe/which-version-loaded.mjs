// 判断浏览器里实际加载的是修好的版本还是带 bug 的版本。
import { connect, sleep } from './cdp.js';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const page = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await page.send('Page.enable');
await sleep(2500);

// 取浏览器里那份 service-worker.js 的内容
const loaded = await page.eval(`
  fetch(chrome.runtime.getURL('src/background/service-worker.js'))
    .then(r => r.text())
    .then(t => {
      const buggy = /normalizeKeywords,\\s*\\n\\s*normalizeList,/.test(t);
      const fixed = /needsReview,\\s*\\n\\s*normalizeList,/.test(t);
      return JSON.stringify({ length: t.length, buggySignature: buggy, fixedSignature: fixed, head: t.slice(0, 60) });
    })
    .catch(e => 'ERR: ' + e.message)
`);
console.log('浏览器里加载的 service-worker.js:');
console.log(loaded);

// 和磁盘上的比
const disk = readFileSync('src/background/service-worker.js', 'utf8');
console.log(`\n磁盘 E:\\x 上的版本长度: ${disk.length}`);
console.log('磁盘版本是修好的吗:', /needsReview,\s*\n\s*normalizeList,/.test(disk));

// 再确认一次动态 import 是否还报错
const check = await page.eval(`
  import(chrome.runtime.getURL('src/background/service-worker.js'))
    .then(() => 'OK 加载成功')
    .catch(e => 'FAIL ' + (e && (e.message || e.toString())))
`).catch(e => 'FAIL(外层) ' + e.message);
console.log('\n动态 import 结果:', check);

// 列出这个扩展目录里能读到哪些文件，反推加载源
const files = await page.eval(`
  Promise.all(['manifest.json','src/lib/store.js','src/lib/guardrails.js','src/background/service-worker.js']
    .map(p => fetch(chrome.runtime.getURL(p)).then(r => p + ':' + r.status).catch(e => p + ':ERR')))
    .then(a => a.join('  '))
`);
console.log('\n可读文件:', files);

process.exit(0);
