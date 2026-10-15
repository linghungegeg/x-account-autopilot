// 移除先审后发后，弹窗和面板是否还正常。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);

const errors = [];
popup.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
});
await popup.send('Runtime.enable');
await popup.send('Page.enable');
await sleep(4000);

console.log('=== 弹窗 ===');
console.log(await popup.eval(`JSON.stringify({
  status: document.querySelector('#status')?.textContent,
  acct: document.querySelector('#acctName')?.textContent,
  hasModeSeg: !!document.querySelector('#modeAuto') || !!document.querySelector('#modeReview'),
  hasReviewSection: !!document.querySelector('#reviewList'),
  hasEnabled: !!document.querySelector('#enabled'),
  hasDryRun: !!document.querySelector('#dryRun'),
  pending: document.querySelector('#pendingCount')?.textContent,
  queueItems: document.querySelectorAll('#queueList .item').length,
  logRows: document.querySelectorAll('#logs .log').length,
  buttons: [...document.querySelectorAll('button')].map(b => b.id).filter(Boolean)
}, null, 2)`));

console.log('\n=== 后台状态字段 ===');
console.log(await popup.eval(`
  chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify({
    ok: r.ok,
    hasReviewCount: 'reviewCount' in r.state,
    hasMode: 'mode' in r.state.behavior,
    pendingCount: r.state.pendingCount,
    blockReason: r.state.blockReason
  }, null, 2))
`));

console.log('\n=== 面板（x.com 页面）===');
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTab = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
if (xTab) {
  const xPage = await cdp.attach(xTab);
  await xPage.send('Page.enable');
  await xPage.send('Page.reload');
  await sleep(9000);
  console.log(await xPage.eval(`JSON.stringify({
    panelHost: !!document.getElementById('x-helper-panel-host'),
    countText: document.getElementById('x-helper-panel-host')?.shadowRoot?.querySelector('.count')?.textContent,
    handleText: document.getElementById('x-helper-panel-host')?.shadowRoot?.querySelector('.handle-text')?.textContent
  })`));
} else {
  console.log('没有 x.com 标签页');
}

console.log('\n=== 弹窗报错 ===');
console.log(errors.length ? errors.slice(0, 6).join('\n') : '  （无）');

process.exit(0);
