// 重载扩展 + 刷新 X 页面 + 验证。改完代码后跑这个。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const EXT_ID = process.env.EXT_ID || 'kfdgfjbdhajdfflcolociedlbcameink';

const cdp = await connect({ port: PORT });

// ---------------------------------------------------------------- 1. 重载扩展
console.log('>>> 1. 重载扩展');
const opts = await cdp.newPage(`chrome-extension://${EXT_ID}/src/options/options.html`);
await opts.send('Page.enable');
await sleep(2000);
await opts.eval(`(() => { chrome.runtime.reload(); return true; })()`).catch(() => {});
await sleep(6000);

// ---------------------------------------------------------------- 2. 刷新 X 页面
console.log('>>> 2. 刷新 x.com 页面（让内容脚本重新注入）');
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
const xTarget = targets.find(t => t.type === 'page' && t.url.includes('x.com'));
if (!xTarget) {
  console.log('  ❌ 没有 x.com 页面');
  process.exit(1);
}
const xPage = await cdp.attach(xTarget);
await xPage.send('Page.enable');
await xPage.send('Page.reload');
await sleep(8000);

// ---------------------------------------------------------------- 3. 验证
console.log('\n>>> 3. 验证');

const panel = await xPage.eval(`(() => {
  const host = document.getElementById('x-helper-panel-host');
  return {
    panelHost: !!host,
    hasShadow: !!host?.shadowRoot,
    handleText: host?.shadowRoot?.querySelector('.handle-text')?.textContent || null,
    drawerHidden: host?.shadowRoot?.querySelector('.drawer')?.hidden ?? null
  };
})()`);
console.log('面板:', JSON.stringify(panel, null, 2));

// 打开 popup 看账号
const popup = await cdp.newPage(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
await popup.send('Page.enable');
await sleep(4000);

const popupState = await popup.eval(`(() => ({
  status: document.querySelector('#status')?.textContent,
  acctName: document.querySelector('#acctName')?.textContent,
  acctHandle: document.querySelector('#acctHandle')?.textContent,
  acctDays: document.querySelector('#acctDays')?.textContent,
  avatarSet: !!document.querySelector('#acctAvatar')?.getAttribute('src')
}))()`);
console.log('\n弹窗:', JSON.stringify(popupState, null, 2));

// 后台状态
const all = await popup.eval(`chrome.runtime.sendMessage({type:'GET_ALL'}).then(r => JSON.stringify({
  ok: r.ok,
  account: r.state?.account,
  enabled: r.state?.behavior?.enabled,
  dryRun: r.state?.behavior?.dryRun,
  presetLabel: r.state?.presetLabel,
  keywords: r.state?.keywords,
  logs: (r.state?.logs || []).slice(0, 3).map(l => l.tag + ' ' + l.message)
}))`);
console.log('\n后台:', all);

process.exit(0);
