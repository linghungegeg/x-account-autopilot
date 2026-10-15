// 实测视频上传：用 CDP 原生 DOM.setFileInputFiles 塞一个真实 mp4，
// 抓上传接口的 media_category，确认 X 到底收不收视频。
// 全程在一个新标签页里做，测完直接关掉该标签页丢弃草稿。
import { writeFileSync } from 'node:fs';
import { connect, sleep } from './cdp.js';

const PORT = Number(process.env.X_CDP_PORT) || 9223;
const OUT = 'probe/result-live-video.json';
const VIDEO = process.argv[2] || 'C:\\Users\\Administrator\\Downloads\\snaptik_7676490716490632479_v3.mp4';

const cdp = await connect({ port: PORT });
console.log('已有页面:', cdp.pages.map(p => p.url).join(', '));

// 先开一个新标签页，这样待会儿关掉它不会带走整个浏览器
const page = await cdp.newPage('https://x.com/home');
console.log('新标签页已打开');

const net = [];
page.on(msg => {
  if (msg.method === 'Network.requestWillBeSent') {
    const url = msg.params.request.url;
    if (/upload\.x\.com|media\/upload|\/graphql\//.test(url)) {
      net.push({ kind: 'req', url: url.split('?')[0], query: url.split('?')[1] || '', method: msg.params.request.method });
    }
  } else if (msg.method === 'Network.responseReceived') {
    const url = msg.params.response.url;
    if (/upload\.x\.com|media\/upload/.test(url)) {
      net.push({ kind: 'res', url: url.split('?')[0], query: url.split('?')[1] || '', status: msg.params.response.status });
    }
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  }
});

await page.send('Network.enable');
await page.send('Page.enable');
await page.send('DOM.enable');
await sleep(5000);

const loggedIn = await page.eval(`!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')`);
console.log('登录态:', loggedIn);
if (!loggedIn) { console.log('❌ 未登录，无法测试'); process.exit(1); }

const accept = await page.eval(`document.querySelector('[data-testid="fileInput"]')?.getAttribute('accept')`);
console.log('fileInput accept:', accept);

// ---------------------------------------------------------------- 塞视频
const doc = await page.send('DOM.getDocument');
const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-testid="fileInput"]' });
if (!nodeId) { console.log('❌ 找不到 fileInput 节点'); process.exit(1); }

console.log(`\n>>> 塞入视频: ${VIDEO}`);
net.length = 0;
await page.send('DOM.setFileInputFiles', { nodeId, files: [VIDEO] });

// 视频要服务端转码，给足时间
let attached = false;
for (let i = 0; i < 40; i++) {
  await sleep(2000);
  const state = await page.eval(`(() => ({
    attachments: !!document.querySelector('[data-testid="attachments"]'),
    progress: !!document.querySelector('[data-testid="progressBar-bar"]'),
    toast: (document.querySelector('[data-testid="toast"]')?.innerText || '').trim(),
    video: !!document.querySelector('[data-testid="attachments"] video'),
    img: document.querySelectorAll('[data-testid="attachments"] img').length,
    submitDisabled: (() => { const b = document.querySelector('[data-testid="tweetButtonInline"]'); return b ? (b.disabled || b.getAttribute('aria-disabled')) : null; })()
  }))()`);

  if (i % 3 === 0 || state.attachments || state.toast) {
    console.log(`  ${(i + 1) * 2}s  附件=${state.attachments} 进度条=${state.progress} video=${state.video} img=${state.img} 提交禁用=${state.submitDisabled}${state.toast ? ` toast="${state.toast}"` : ''}`);
  }
  if (state.attachments && !state.progress) { attached = true; break; }
  if (state.toast && /error|失败|无法|not|can't|invalid|unsupported/i.test(state.toast)) break;
}

// ---------------------------------------------------------------- 结果
const final = await page.eval(`(() => {
  const a = document.querySelector('[data-testid="attachments"]');
  return {
    attachments: !!a,
    html: a ? a.outerHTML.slice(0, 500) : null,
    hasVideoTag: !!a?.querySelector('video'),
    videoSrc: (a?.querySelector('video')?.getAttribute('src') || '').slice(0, 80),
    imgCount: a ? a.querySelectorAll('img').length : 0,
    toast: (document.querySelector('[data-testid="toast"]')?.innerText || '').trim()
  };
})()`);

console.log('\n=== 最终状态 ===');
console.log(JSON.stringify(final, null, 2));

console.log('\n=== 视频上传网络（去重）===');
const seen = new Set();
for (const n of net) {
  const key = `${n.kind}|${n.query.split('&')[0]}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const cat = (n.query.match(/media_category=([^&]+)/) || [])[1];
  const cmd = (n.query.match(/command=([^&]+)/) || [])[1];
  console.log(`  [${n.kind}] ${n.status ?? n.method} ${n.url}  ${cmd ? 'command=' + cmd : ''} ${cat ? 'category=' + decodeURIComponent(cat) : ''}`);
}

const initCall = net.find(n => n.query.includes('command=INIT'));
console.log('\nINIT 参数:', initCall ? decodeURIComponent(initCall.query) : '(没抓到)');

writeFileSync(OUT, JSON.stringify({ accept, final, net }, null, 2));

// ---------------------------------------------------------------- 丢弃草稿
console.log('\n>>> 关闭测试标签页，丢弃草稿');
await fetch(`http://127.0.0.1:${PORT}/json/close/${page.target.id}`, { method: 'PUT' }).catch(() => {});
await sleep(1000);

const rest = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
console.log('剩余页面:', rest.filter(t => t.type === 'page').map(t => t.url).join(', '));
console.log(`\n完整结果: ${OUT}`);
process.exit(0);
