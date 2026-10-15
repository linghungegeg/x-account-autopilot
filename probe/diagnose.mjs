// 诊断「未连接 X」：逐层检查扩展是否正常。
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const cdp = await connect({ port: PORT });

// ---------------------------------------------------------------- 1. 扩展是否加载
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('=== 1. CDP 目标 ===');
targets.forEach(t => console.log(`  [${t.type}] ${t.url.slice(0, 120)}`));

const extTarget = targets.find(t => t.url.startsWith('chrome-extension://'));
if (!extTarget) {
  console.log('\n❌ 没有 chrome-extension:// 目标 —— 扩展没加载成功');
  process.exit(1);
}
const id = new URL(extTarget.url).host;
console.log(`\n✅ 扩展 ID: ${id}`);

const swTarget = targets.find(t => t.type === 'service_worker' && t.url.includes('service-worker.js'));
console.log(`   Service Worker: ${swTarget ? '✅ 在跑' : '⚠️ 没在跑（可能只是休眠）'}`);

// ---------------------------------------------------------------- 2. popup 页面
console.log('\n=== 2. 打开 popup 页面 ===');
const popup = await cdp.newPage(`chrome-extension://${id}/src/popup/popup.html`);

// 抓 popup 的报错
const popupErrors = [];
popup.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') {
    popupErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    popupErrors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
  }
});
await popup.send('Runtime.enable');
await popup.send('Page.enable');
await popup.send('Page.reload');
await sleep(3500);

const popupState = await popup.eval(`(() => ({
  status: document.querySelector('#status')?.textContent,
  statusClass: document.querySelector('#status')?.className,
  acctName: document.querySelector('#acctName')?.textContent,
  acctHandle: document.querySelector('#acctHandle')?.textContent,
  acctDays: document.querySelector('#acctDays')?.textContent,
  enabled: document.querySelector('#enabled')?.checked,
  hasChromeRuntime: typeof chrome !== 'undefined' && !!chrome.runtime?.id
}))()`);
console.log('popup 界面状态:', JSON.stringify(popupState, null, 2));
if (popupErrors.length) console.log('popup 报错:', popupErrors);

// ---------------------------------------------------------------- 3. 直接问后台
console.log('\n=== 3. 直接调后台 GET_ALL ===');
try {
  const all = await popup.eval(`chrome.runtime.sendMessage({ type: 'GET_ALL' }).then(r => JSON.stringify(r).slice(0, 600)).catch(e => 'ERR: ' + e.message)`);
  console.log(all);
} catch (error) {
  console.log('调用失败:', error.message);
}

// ---------------------------------------------------------------- 4. 内容脚本是否注入
console.log('\n=== 4. x.com 页面上的内容脚本 ===');
const xPage = cdp.pages.find(p => p.url.includes('x.com'));
if (!xPage) {
  console.log('⚠️ 没有 x.com 页面');
} else {
  const attached = await cdp.attach(xPage);
  const dom = await attached.eval(`(() => ({
    url: location.href,
    panelHost: !!document.getElementById('x-helper-panel-host'),
    loggedIn: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
    profileLink: document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || null,
    avatarContainer: document.querySelector('[data-testid^="UserAvatar-Container-"]')?.getAttribute('data-testid') || null,
    switcherImgAlt: document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img')?.getAttribute('alt') || null
  }))()`);
  console.log('x.com 页面:', JSON.stringify(dom, null, 2));
  console.log(dom.panelHost
    ? '✅ 内容脚本已注入（面板容器存在）'
    : '❌ 内容脚本没注入（没有 #x-helper-panel-host）—— 需要刷新这个页面');

  // 从 popup 侧问一次 X_GET_STATE（走 SW -> content script）
  console.log('\n=== 5. 走后台问一次 X_GET_STATE ===');
  const state = await popup.eval(`chrome.runtime.sendMessage({ type: 'X_GET_STATE' }).then(r => JSON.stringify(r).slice(0, 700)).catch(e => 'ERR: ' + e.message)`);
  console.log(state);
}

console.log('\n扩展 ID（后面测试要用）:', id);
process.exit(0);
